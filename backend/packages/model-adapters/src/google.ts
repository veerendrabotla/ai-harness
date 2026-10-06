import { GoogleGenAI } from "@google/genai";
import type { ProviderType } from "@ai-harness/contracts";
import {
  AdapterError,
  type HealthResult,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
  type ProviderConnectionRef,
} from "./types.js";

/** Google Gemini adapter (@google/genai ^1.x). */
export class GoogleAdapter implements ModelAdapter {
  readonly providerType: ProviderType = "GOOGLE";

  private client(connection: ProviderConnectionRef): GoogleGenAI {
    if (!connection.credential) {
      throw new AdapterError(this.providerType, "NO_CREDENTIAL", "Provider connection has no credential", false);
    }
    // Optional endpoint override (proxies, emulators, mock servers) — mirrors
    // the Ollama adapter's metadata.baseUrl contract.
    const baseUrl = connection.metadata?.["baseUrl"];
    return new GoogleGenAI({
      apiKey: connection.credential,
      ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
    });
  }

  async healthCheck(connection: ProviderConnectionRef): Promise<HealthResult> {
    const started = Date.now();
    try {
      await this.client(connection).models.generateContent({
        model: connection.metadata?.["healthCheckModel"] ?? "gemini-2.0-flash",
        contents: "ping",
        config: { maxOutputTokens: 5 },
      });
      return { ok: true, detail: "Google endpoint reachable", latencyMs: Date.now() - started };
    } catch (err) {
      console.error("[Google] Health check failed:", err);
      return {
        ok: false,
        detail: `Google health check failed: redacted`,
        latencyMs: Date.now() - started,
        retryable: true,
      };
    }
  }

  async generate(request: ModelRequest, connection: ProviderConnectionRef): Promise<ModelResponse> {
    try {
      const response = await this.client(connection).models.generateContent({
        model: request.modelIdentifier,
        contents: [
          request.userObjective,
          request.contextItems ? `\n\nContext:\n${request.contextItems}` : "",
          request.priorRunSummary ? `\n\nPrior run summary:\n${request.priorRunSummary}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        config: {
          systemInstruction:
            request.systemInstructions +
            (request.responseSchemaName === "PLAN"
              ? "\nRespond with ONLY a single JSON object. No prose."
              : ""),
          maxOutputTokens: request.maxOutputTokens ?? 4096,
          temperature: request.temperature,
        },
      });
      const candidate = response.candidates?.[0];
      return {
        text: response.text ?? "",
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? null,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
        },
        finishReason: String(candidate?.finishReason ?? "unknown"),
        providerRequestId: response.responseId ?? null,
        modelIdentifier: request.modelIdentifier,
        providerType: this.providerType,
      };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      console.error("[Google] Generation failed:", err);
      throw new AdapterError(this.providerType, "PROVIDER_ERROR", "Google generation failed: redacted", true);
    }
  }

  async stream(
    request: ModelRequest,
    connection: ProviderConnectionRef,
    onDelta: (text: string) => void,
  ): Promise<ModelResponse> {
    try {
      const response = await this.client(connection).models.generateContentStream({
        model: request.modelIdentifier,
        contents: [
          request.userObjective,
          request.contextItems ? `\n\nContext:\n${request.contextItems}` : "",
          request.priorRunSummary ? `\n\nPrior run summary:\n${request.priorRunSummary}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        config: {
          systemInstruction:
            request.systemInstructions +
            (request.responseSchemaName === "PLAN"
              ? "\nRespond with ONLY a single JSON object. No prose."
              : ""),
          maxOutputTokens: request.maxOutputTokens ?? 4096,
          temperature: request.temperature,
        },
      });
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason = "unknown";
      let providerRequestId: string | null = null;
      for await (const chunk of response) {
        const text = chunk.text ?? "";
        if (text) {
          fullText += text;
          onDelta(text);
        }
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
        }
        if (chunk.candidates?.[0]?.finishReason) {
          finishReason = String(chunk.candidates[0].finishReason);
        }
        if (chunk.responseId) {
          providerRequestId = chunk.responseId;
        }
      }
      return {
        text: fullText,
        usage: { inputTokens, outputTokens },
        finishReason,
        providerRequestId,
        modelIdentifier: request.modelIdentifier,
        providerType: this.providerType,
      };
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      console.error("[Google] Streaming failed:", err);
      throw new AdapterError(this.providerType, "PROVIDER_ERROR", "Google streaming failed: redacted", true);
    }
  }
}
