import type { ProviderType } from "@ai-harness/contracts";

export interface ModelToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** Normalized model request — logically identical for every provider (AGENT_RUNTIME.md §7). */
export interface ModelRequest {
  stage: "PLANNING" | "IMPLEMENTATION" | "REVIEW";
  /** Resolved by the Model Router; adapters pass it through to their SDK. */
  modelIdentifier: string;
  systemInstructions: string;
  userObjective: string;
  contextItems: string;
  toolDefinitions?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  priorRunSummary?: string | null;
  /** When set to PLAN, adapters must return JSON conforming to the plan schema. */
  responseSchemaName?: "PLAN" | "FREEFORM";
  maxOutputTokens?: number;
  /** Sampling temperature; passed through to the provider (Anthropic clamped to [0, 1]). */
  temperature?: number;
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ModelResponse {
  text: string;
  usage: ModelUsage;
  finishReason: string;
  providerRequestId: string | null;
  modelIdentifier: string;
  providerType: ProviderType;
  /** Native tool-use proposals when the provider supports tool calling. */
  toolCalls?: Array<ModelToolCall>;
}

export interface ProviderConnectionRef {
  id: string;
  providerType: ProviderType;
  displayName: string;
  /** Decrypted credential; never logged or persisted in plaintext. */
  credential: string;
  metadata?: Record<string, string>;
}

export interface HealthResult {
  ok: boolean;
  detail: string;
  latencyMs: number;
  retryable?: boolean;
}

/** Normalized adapter failure with retry classification (AGENT_RUNTIME.md §16). */
export class AdapterError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  readonly providerType: ProviderType;

  constructor(providerType: ProviderType, code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "AdapterError";
    this.providerType = providerType;
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Provider adapter interface (TECH_STACK.md / AGENT_RUNTIME.md §8).
 * The rest of the application depends ONLY on this interface.
 */
export interface ModelAdapter {
  readonly providerType: ProviderType;
  healthCheck(connection: ProviderConnectionRef): Promise<HealthResult>;
  generate(request: ModelRequest, connection: ProviderConnectionRef): Promise<ModelResponse>;
  /** Incremental deltas; adapters without streaming support throw NOT_SUPPORTED. */
  stream(
    request: ModelRequest,
    connection: ProviderConnectionRef,
    onDelta: (text: string) => void,
  ): Promise<ModelResponse>;
}

export function notSupported(providerType: ProviderType): AdapterError {
  return new AdapterError(providerType, "NOT_SUPPORTED", "Streaming is not supported by this adapter yet", false);
}
