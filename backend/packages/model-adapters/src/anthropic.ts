import Anthropic from "@anthropic-ai/sdk";
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

function buildRequest(request: ModelRequest) {
  const system = [
    request.systemInstructions,
    request.responseSchemaName === "PLAN"
      ? "Respond with ONLY a single JSON object matching the requested schema. No prose, no markdown fences."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userContent = [
    request.userObjective,
    request.contextItems ? `\n\nContext:\n${request.contextItems}` : "",
    request.priorRunSummary ? `\n\nPrior run summary:\n${request.priorRunSummary}` : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    model: request.modelIdentifier,
    system,
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(request.temperature !== undefined
      ? { temperature: Math.min(1, Math.max(0, request.temperature)) }
      : {}),
    messages: [{ role: "user" as const, content: userContent }],
    ...(request.toolDefinitions?.length
      ? {
          tools: request.toolDefinitions.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema,
          })),
        }
      : {}),
  };
}

/** Anthropic Messages API adapter (@anthropic-ai/sdk 0.39.0). */
export class AnthropicAdapter implements ModelAdapter {
  readonly providerType: ProviderType = "ANTHROPIC";

  private client(connection: ProviderConnectionRef): Anthropic {
    if (!connection.credential) {
      throw new AdapterError(this.providerType, "NO_CREDENTIAL", "Provider connection has no credential", false);
    }
    return new Anthropic({
      apiKey: connection.credential,
      baseURL: connection.metadata?.["baseUrl"] || undefined,
      maxRetries: 0,
    });
  }

  async healthCheck(connection: ProviderConnectionRef): Promise<HealthResult> {
    const started = Date.now();
    try {
      await this.client(connection).messages.create({
        model: connection.metadata?.["healthCheckModel"] ?? "claude-3-5-haiku-latest",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true, detail: "Anthropic reachable", latencyMs: Date.now() - started };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return {
        ok: false,
        detail: `Anthropic health check failed${status ? ` (HTTP ${status})` : ""}: ${(err as Error).message}`,
        latencyMs: Date.now() - started,
        retryable: isRetryable(status),
      };
    }
  }

  async generate(request: ModelRequest, connection: ProviderConnectionRef): Promise<ModelResponse> {
    const client = this.client(connection);
    try {
      const response = await client.messages.create({ ...buildRequest(request), stream: false });
      let text = "";
      const toolCalls: ModelToolCall[] = [];
      for (const block of response.content) {
        if (block.type === "text") text += block.text;
        if (block.type === "tool_use") {
          toolCalls.push({ name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
        }
      }
      return {
        text,
        usage: {
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
        },
        finishReason: response.stop_reason ?? "unknown",
        providerRequestId: response.id ?? null,
        modelIdentifier: response.model ?? request.modelIdentifier,
        providerType: this.providerType,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new AdapterError(
        this.providerType,
        status === 401 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_ERROR",
        `Anthropic generation failed${status ? ` (HTTP ${status})` : ""}: redacted`,
        isRetryable(status),
      );
    }
  }

  async stream(
    request: ModelRequest,
    _connection: ProviderConnectionRef,
    onDelta: (text: string) => void,
  ): Promise<ModelResponse> {
    const client = this.client(_connection);
    try {
      const stream = client.messages.stream(buildRequest(request));
      stream.on("text", onDelta);
      const final = await stream.finalMessage();
      return {
        text: final.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
        usage: {
          inputTokens: final.usage?.input_tokens ?? null,
          outputTokens: final.usage?.output_tokens ?? null,
        },
        finishReason: final.stop_reason ?? "unknown",
        providerRequestId: final.id ?? null,
        modelIdentifier: final.model ?? request.modelIdentifier,
        providerType: this.providerType,
      };
    } catch (err) {
      console.error("[Anthropic] Stream failed:", err);
      throw new AdapterError(this.providerType, "PROVIDER_ERROR", "Anthropic stream failed: redacted", false);
    }
  }
}
