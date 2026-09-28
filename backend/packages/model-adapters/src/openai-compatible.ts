import type { ProviderType } from "@ai-harness/contracts";
import {
  AdapterError,
  type HealthResult,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
  type ProviderConnectionRef,
} from "./types.js";

/**
 * OpenAI-compatible HTTP adapter using native fetch.
 * Covers vLLM, LM Studio, Ollama's /v1 endpoint, OpenRouter and similar servers.
 * `metadata.baseUrl` MUST be provided on the connection; credential may be empty
 * for local servers that do not require an API key.
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly providerType: ProviderType = "OPENAI_COMPATIBLE";

  private baseUrl(connection: ProviderConnectionRef): string {
    const base = connection.metadata?.["baseUrl"];
    if (!base) {
      throw new AdapterError(
        this.providerType,
        "NO_BASE_URL",
        "OPENAI_COMPATIBLE connections require a baseUrl in connection metadata",
        false,
      );
    }
    return base.replace(/\/+$/, "");
  }

  async healthCheck(connection: ProviderConnectionRef): Promise<HealthResult> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl(connection)}/models`, {
        headers: this.headers(connection),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return {
          ok: false,
          detail: `Endpoint returned HTTP ${res.status}`,
          latencyMs: Date.now() - started,
          retryable: res.status >= 500,
        };
      }
      return { ok: true, detail: "Endpoint reachable", latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        detail: `Endpoint unreachable: ${redactMessage((err as Error).message)}`,
        latencyMs: Date.now() - started,
        retryable: true,
      };
    }
  }

  async generate(request: ModelRequest, connection: ProviderConnectionRef): Promise<ModelResponse> {
    const url = `${this.baseUrl(connection)}/chat/completions`;
    const body = {
      model: request.modelIdentifier,
      messages: [
        {
          role: "system",
          content:
            request.systemInstructions +
            (request.responseSchemaName === "PLAN"
              ? "\nRespond with ONLY a single JSON object matching the requested schema."
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
      ],
      max_tokens: request.maxOutputTokens ?? 4096,
      temperature: request.temperature,
      ...(request.responseSchemaName === "PLAN" ? { response_format: { type: "json_object" } } : {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { ...this.headers(connection), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      throw new AdapterError(this.providerType, "ENDPOINT_UNREACHABLE", `Request failed: ${redactMessage((err as Error).message)}`, true);
    }

    if (!res.ok) {
      throw new AdapterError(
        this.providerType,
        res.status === 401 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_ERROR",
        `Endpoint returned HTTP ${res.status}`,
        res.status === 429 || res.status >= 500,
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      id?: string;
      model?: string;
    };

    return {
      text: json.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? null,
        outputTokens: json.usage?.completion_tokens ?? null,
      },
      finishReason: json.choices?.[0]?.finish_reason ?? "unknown",
      providerRequestId: json.id ?? null,
      modelIdentifier: json.model ?? request.modelIdentifier,
      providerType: this.providerType,
    };
  }

  async stream(
    request: ModelRequest,
    connection: ProviderConnectionRef,
    onDelta: (text: string) => void,
  ): Promise<ModelResponse> {
    const url = `${this.baseUrl(connection)}/chat/completions`;
    const body = {
      model: request.modelIdentifier,
      messages: [
        {
          role: "system",
          content:
            request.systemInstructions +
            (request.responseSchemaName === "PLAN"
              ? "\nRespond with ONLY a single JSON object matching the requested schema."
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
      ],
      max_tokens: request.maxOutputTokens ?? 4096,
      temperature: request.temperature,
      stream: true,
      ...(request.responseSchemaName === "PLAN" ? { response_format: { type: "json_object" } } : {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { ...this.headers(connection), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      throw new AdapterError(this.providerType, "ENDPOINT_UNREACHABLE", `Request failed: ${redactMessage((err as Error).message)}`, true);
    }

    if (!res.ok) {
      throw new AdapterError(
        this.providerType,
        res.status === 401 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_ERROR",
        `Endpoint returned HTTP ${res.status}`,
        res.status === 429 || res.status >= 500,
      );
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new AdapterError(this.providerType, "PROVIDER_ERROR", "No response body", true);
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = "unknown";
    let providerRequestId: string | null = null;
    let model = request.modelIdentifier;
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string; index?: number }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              id?: string;
              model?: string;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onDelta(delta);
            }
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
            }
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens ?? inputTokens;
              outputTokens = parsed.usage.completion_tokens ?? outputTokens;
            }
            if (parsed.id) providerRequestId = parsed.id;
            if (parsed.model) model = parsed.model;
          } catch (err) {
            console.error("[OpenAI] Malformed SSE line:", err);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      text: fullText,
      usage: { inputTokens, outputTokens },
      finishReason,
      providerRequestId,
      modelIdentifier: model,
      providerType: this.providerType,
    };
  }
  private headers(connection: ProviderConnectionRef): Record<string, string> {
    return connection.credential ? { authorization: `Bearer ${connection.credential}` } : {};
  }
}

function redactMessage(message: string): string {
  // Never leak Authorization headers through error strings.
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}
