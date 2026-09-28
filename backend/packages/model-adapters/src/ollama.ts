import { Ollama } from "ollama";
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
 * Native Ollama adapter (ollama SDK 0.5.14).
 * Connection metadata.baseUrl holds the local host (e.g. http://localhost:11434).
 */
export class OllamaAdapter implements ModelAdapter {
  readonly providerType: ProviderType = "OLLAMA";

  private client(connection: ProviderConnectionRef): Ollama {
    const host = connection.metadata?.["baseUrl"];
    if (!host) {
      throw new AdapterError(this.providerType, "NO_BASE_URL", "OLLAMA connections require baseUrl metadata", false);
    }
    return new Ollama({ host });
  }

  async healthCheck(connection: ProviderConnectionRef): Promise<HealthResult> {
    const started = Date.now();
    try {
      const models = await this.client(connection).list();
      return {
        ok: true,
        detail: `Ollama reachable (${models.models.length} models)`,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      console.error("[Ollama] Health check failed:", err);
      return {
        ok: false,
        detail: "Ollama unreachable",
        latencyMs: Date.now() - started,
        retryable: true,
      };
    }
  }

  async generate(request: ModelRequest, connection: ProviderConnectionRef): Promise<ModelResponse> {
    try {
      const response = await this.client(connection).chat({
        model: request.modelIdentifier,
        stream: false,
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
        format: request.responseSchemaName === "PLAN" ? ("json" as const) : undefined,
        options: { num_predict: request.maxOutputTokens ?? 4096, temperature: request.temperature },
      });
      return {
        text: response.message.content,
        usage: {
          inputTokens: response.prompt_eval_count ?? null,
          outputTokens: response.eval_count ?? null,
        },
        finishReason: response.done_reason ?? "stop",
        providerRequestId: null,
        modelIdentifier: response.model ?? request.modelIdentifier,
        providerType: this.providerType,
      };
    } catch (err) {
      console.error("[Ollama] Generation failed:", err);
      throw new AdapterError(this.providerType, "PROVIDER_ERROR", "Ollama generation failed", true);
    }
  }

  async stream(
    request: ModelRequest,
    connection: ProviderConnectionRef,
    onDelta: (text: string) => void,
  ): Promise<ModelResponse> {
    try {
      const stream = await this.client(connection).chat({
        model: request.modelIdentifier,
        stream: true,
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
        format: request.responseSchemaName === "PLAN" ? ("json" as const) : undefined,
        options: { num_predict: request.maxOutputTokens ?? 4096, temperature: request.temperature },
      });
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason = "stop";
      let model = request.modelIdentifier;
      for await (const chunk of stream) {
        const text = chunk.message?.content ?? "";
        if (text) {
          fullText += text;
          onDelta(text);
        }
        if (chunk.prompt_eval_count) inputTokens = chunk.prompt_eval_count;
        if (chunk.eval_count) outputTokens = chunk.eval_count;
        if (chunk.done_reason) finishReason = chunk.done_reason;
        if (chunk.model) model = chunk.model;
      }
      return {
        text: fullText,
        usage: { inputTokens, outputTokens },
        finishReason,
        providerRequestId: null,
        modelIdentifier: model,
        providerType: this.providerType,
      };
    } catch (err) {
      console.error("[Ollama] Streaming failed:", err);
      throw new AdapterError(this.providerType, "PROVIDER_ERROR", "Ollama streaming failed", true);
    }
  }
}
