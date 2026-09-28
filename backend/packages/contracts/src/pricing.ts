/**
 * Canonical model pricing — single source of truth for the whole platform.
 *
 * Prices are USD per 1K tokens (input, output) and are intentionally
 * approximate; update here only, consumers derive their maps:
 * - `apps/api` usage tracking (estimateCost)
 * - `apps/api` playground cost estimate
 * - `apps/api` model catalog (`/v1/models`, `/v1/models/providers`)
 * - `@ai-harness/cost-tracker` default price maps
 *
 * Keyed by the bare model identifier as sent to providers. Aliases used by
 * older rows (e.g. `claude-3.5-sonnet`, `openai/gpt-4o`) resolve through
 * {@link resolveModelPricing}.
 */

export interface ModelPricing {
  /** USD per 1K input/prompt tokens. */
  input: number;
  /** USD per 1K output/completion tokens. */
  output: number;
}

export const MODEL_PRICING_PER_1K: Readonly<Record<string, ModelPricing>> = {
  // OpenAI
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4": { input: 0.03, output: 0.06 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },
  "gpt-5": { input: 0.005, output: 0.015 },
  "gpt-5-mini": { input: 0.0005, output: 0.002 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "gpt-3.5-turbo-16k": { input: 0.003, output: 0.006 },
  "o1": { input: 0.015, output: 0.06 },
  "o1-mini": { input: 0.003, output: 0.012 },
  "o3": { input: 0.01, output: 0.04 },
  "o3-mini": { input: 0.0011, output: 0.0044 },

  // Anthropic
  "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 },
  "claude-sonnet-4": { input: 0.003, output: 0.015 },
  "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
  "claude-opus-4": { input: 0.015, output: 0.075 },
  "claude-opus-4-1": { input: 0.015, output: 0.075 },
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
  "claude-3-5-haiku-20241022": { input: 0.0008, output: 0.004 },
  "claude-haiku-3-5": { input: 0.0008, output: 0.004 },
  "claude-3-opus-20240229": { input: 0.015, output: 0.075 },
  "claude-3-sonnet-20240229": { input: 0.003, output: 0.015 },
  "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
  "claude-2.1": { input: 0.008, output: 0.024 },
  "claude-2.0": { input: 0.008, output: 0.024 },
  "claude-instant-1.2": { input: 0.0008, output: 0.0024 },
  // Legacy aliases kept for older usage rows / API responses
  "claude-3.5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-opus": { input: 0.015, output: 0.075 },
  "claude-3-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku": { input: 0.00025, output: 0.00125 },

  // Google
  "gemini-1.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-1.5-flash": { input: 0.000075, output: 0.0003 },
  "gemini-2.0-flash": { input: 0.0001, output: 0.0004 },
  "gemini-2.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-2.5-flash": { input: 0.00015, output: 0.0006 },

  // Mistral
  "mistral-large-latest": { input: 0.002, output: 0.006 },
  "mistral-medium-latest": { input: 0.0027, output: 0.0081 },
  "mistral-small-latest": { input: 0.001, output: 0.003 },
  "codestral-latest": { input: 0.001, output: 0.003 },

  // DeepSeek
  "deepseek-chat": { input: 0.00014, output: 0.00028 },
  "deepseek-coder": { input: 0.00028, output: 0.00056 },

  // xAI
  "grok-3": { input: 0.003, output: 0.015 },
  "grok-3-mini": { input: 0.0003, output: 0.0015 },

  // OpenRouter / router-scoped ids
  "meta-llama/llama-3.1-405b-instruct": { input: 0.002, output: 0.006 },
  "meta-llama/llama-3.1-70b-instruct": { input: 0.00052, output: 0.00075 },
  "qwen/qwen-2.5-coder-32b-instruct": { input: 0.00015, output: 0.00025 },

  // Local (self-hosted) models cost nothing at the token level
  "llama3": { input: 0, output: 0 },
  "mistral": { input: 0, output: 0 },
};

const PROVIDER_PREFIXES = ["openai/", "anthropic/", "google/", "mistral/", "deepseek/", "xai/", "meta/"] as const;

const BY_LOWER = new Map<string, ModelPricing>(
  Object.entries(MODEL_PRICING_PER_1K).map(([k, v]) => [k.toLowerCase(), v]),
);

/**
 * Resolves pricing for a model identifier. Accepts bare ids, legacy aliases,
 * and `provider/model` forms used by usage rows (e.g. `openai/gpt-4o`).
 * Returns `null` when the model is unknown — callers decide their fallback.
 */
export function resolveModelPricing(model: string): ModelPricing | null {
  const direct = MODEL_PRICING_PER_1K[model];
  if (direct) return direct;
  const lower = model.toLowerCase();
  const hit = BY_LOWER.get(lower);
  if (hit) return hit;
  for (const prefix of PROVIDER_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const stripped = BY_LOWER.get(lower.slice(prefix.length));
      if (stripped) return stripped;
    }
  }
  return null;
}
