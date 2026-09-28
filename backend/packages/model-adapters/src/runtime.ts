/**
 * Model Runtime — formalized interface for LLM provider abstraction.
 * Wraps model-adapters with additional capabilities: streaming, cancellation, structured output.
 */
import type { ProviderType } from "@ai-harness/contracts";
import type { ModelAdapter, ModelRequest, ModelResponse, ProviderConnectionRef, HealthResult } from "./types.js";
import { transformResponse } from "./stream-transforms.js";

export interface ModelRuntimeConfig {
  adapters: ModelAdapter[];
  defaultProvider?: ProviderType;
  defaultModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ModelRuntimeRequest extends ModelRequest {
  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;
  /** Timeout override. */
  timeoutMs?: number;
  /** Retry count. */
  retryCount?: number;
}

export interface StreamingCallbacks {
  onDelta?: (text: string) => void;
  onToolCall?: (toolCall: { name: string; input: Record<string, unknown> }) => void;
  onDone?: (response: ModelResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Central model runtime — unified interface for all LLM operations.
 */
export class ModelRuntime {
  private adapterMap: Map<ProviderType, ModelAdapter>;
  private defaultProvider?: ProviderType;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: ModelRuntimeConfig) {
    this.adapterMap = new Map(config.adapters.map(a => [a.providerType, a]));
    this.defaultProvider = config.defaultProvider;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  private getAdapter(providerType: ProviderType): ModelAdapter {
    const adapter = this.adapterMap.get(providerType);
    if (!adapter) throw new Error(`No adapter registered for provider: ${providerType}`);
    return adapter;
  }

  /**
   * Synchronous generation (non-streaming).
   */
  async generate(
    request: ModelRuntimeRequest,
    connection: ProviderConnectionRef,
  ): Promise<ModelResponse> {
    const adapter = this.getAdapter(connection.providerType);
    const timeout = request.timeoutMs ?? this.timeoutMs;
    const retries = request.retryCount ?? this.maxRetries;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const result = await Promise.race([
          adapter.generate(request, connection),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => reject(new Error(`Model request timed out after ${timeout}ms`)), { once: true });
          }),
        ]);
        const transformedText = transformResponse(result.text);
        if (transformedText !== result.text) {
          return { ...result, text: transformedText };
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === retries) throw lastError;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10_000)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError!;
  }

  /**
   * Streaming generation with callbacks.
   */
  async stream(
    request: ModelRuntimeRequest,
    connection: ProviderConnectionRef,
    callbacks: StreamingCallbacks,
  ): Promise<ModelResponse> {
    const adapter = this.getAdapter(connection.providerType);
    const timeout = request.timeoutMs ?? this.timeoutMs;

    let timer: ReturnType<typeof setTimeout>;
    const rawResult = await new Promise<ModelResponse>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Model stream timed out after ${timeout}ms`)), timeout);
      adapter.stream(request, connection, (delta) => {
        callbacks.onDelta?.(delta);
      }).then(resolve, reject);
    }).finally(() => clearTimeout(timer));

    const transformedText = transformResponse(rawResult.text);
    const result: ModelResponse =
      transformedText !== rawResult.text ? { ...rawResult, text: transformedText } : rawResult;

    callbacks.onDone?.(result);
    return result;
  }

  /**
   * Health check for a provider connection.
   */
  async healthCheck(connection: ProviderConnectionRef): Promise<HealthResult> {
    const adapter = this.getAdapter(connection.providerType);
    return adapter.healthCheck(connection);
  }

  /**
   * List all registered providers.
   */
  listProviders(): ProviderType[] {
    return Array.from(this.adapterMap.keys());
  }

  /**
   * Get adapter for a specific provider.
   */
  getAdapterForProvider(providerType: ProviderType): ModelAdapter | undefined {
    return this.adapterMap.get(providerType);
  }
}
