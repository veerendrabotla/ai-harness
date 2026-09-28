import OpenAI from "openai";
import type { ProviderType } from "@ai-harness/contracts";
import {
  AdapterError,
  type HealthResult,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
  type ModelToolCall,
  type ProviderConnectionRef,
} from "./types.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

function isRetryable(status: number | undefined): boolean {
  return status === 429 || status === 408 || (status !== undefined && status >= 500);
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error("[OpenAI] JSON parse failed:", err);
    return null;
  }
}

/** OpenAI Chat Completions adapter (openai SDK 4.86.1). */
export class OpenAIAdapter implements ModelAdapter {
  readonly providerType: ProviderType = "OPENAI";

  private client(connection: ProviderConnectionRef): OpenAI {
    if (!connection.credential) {
      throw new AdapterError(this.providerType, "NO_CREDENTIAL", "Provider connection has no credential", false);
    }
    return new OpenAI({
      apiKey: connection.credential,
      baseURL: connection.metadata?.["baseUrl"] || undefined,
      maxRetries: 0,
    });
  }

  async healthCheck(connection: ProviderConnectionRef): Promise<HealthResult> {
    const started = Date.now();
    try {
      await this.client(connection).chat.completions.create({
        model: connection.metadata?.["healthCheckModel"] ?? "gpt-4o-mini",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true, detail: "OpenAI reachable", latencyMs: Date.now() - started };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return {
        ok: false,
        detail: `OpenAI health check failed${status ? ` (HTTP ${status})` : ""}: ${(err as Error).message}`,
        latencyMs: Date.now() - started,
        retryable: isRetryable(status),
      };
    }
  }

  async generate(request: ModelRequest, connection: ProviderConnectionRef): Promise<ModelResponse> {
    try {
      const response = await this.client(connection).chat.completions.create(this.payload(request));
      const toolCalls = this.mapToolCalls(response);
      return {
        text: response.choices[0]?.message?.content ?? "",
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? null,
          outputTokens: response.usage?.completion_tokens ?? null,
        },
        finishReason: response.choices[0]?.finish_reason ?? "unknown",
        providerRequestId: response.id ?? null,
        modelIdentifier: response.model ?? request.modelIdentifier,
        providerType: this.providerType,
        ...(toolCalls ? { toolCalls } : {}),
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new AdapterError(
        this.providerType,
        status === 401 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_ERROR",
        `OpenAI generation failed${status ? ` (HTTP ${status})` : ""}: redacted`,
        isRetryable(status),
      );
    }
  }

  async stream(
    request: ModelRequest,
    connection: ProviderConnectionRef,
    onDelta: (text: string) => void,
  ): Promise<ModelResponse> {
    const stream = await this.client(connection).chat.completions.create({
      ...this.payload(request),
      stream: true,
      stream_options: { include_usage: true },
    });
    let text = "";
    let usage: ModelResponse["usage"] = { inputTokens: null, outputTokens: null };
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? null,
          outputTokens: chunk.usage.completion_tokens ?? null,
        };
      }
    }
    return {
      text,
      usage,
      finishReason: "stream_end",
      providerRequestId: null,
      modelIdentifier: request.modelIdentifier,
      providerType: this.providerType,
    };
  }

  private payload(request: ModelRequest) {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          request.systemInstructions +
          (request.responseSchemaName === "PLAN"
            ? "\nRespond with ONLY a single JSON object matching the requested schema. No prose, no markdown fences."
            : ""),
      },
      {
        role: "user",
        content: [
          request.userObjective,
          request.contextItems ? `\n\nContext:\n${request.contextItems}` : "",
          request.priorRunSummary ? `\n\nPrior run summary:\n${request.priorRunSummary}` : "",
        ]
          .filter(Boolean)
          .join(""),
      },
    ];
    return {
      model: request.modelIdentifier,
      messages,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      temperature: request.temperature,
      ...(request.responseSchemaName === "PLAN" ? { response_format: { type: "json_object" as const } } : {}),
      ...(request.toolDefinitions?.length
        ? {
            tools: request.toolDefinitions.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };
  }

  private mapToolCalls(response: OpenAI.ChatCompletion): ModelToolCall[] | undefined {
    const raw = response.choices[0]?.message?.tool_calls;
    if (!raw || raw.length === 0) return undefined;
    const calls: ModelToolCall[] = [];
    for (const tc of raw) {
      if ("function" in tc && tc.function) {
        const parsed = safeParse(tc.function.arguments);
        calls.push({ name: tc.function.name, input: parsed ?? {} });
      }
    }
    return calls.length > 0 ? calls : undefined;
  }
}
