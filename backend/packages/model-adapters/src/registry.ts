import type { ProviderType } from "@ai-harness/contracts";
import { errors } from "@ai-harness/shared";
import { AnthropicAdapter } from "./anthropic.js";
import { GoogleAdapter } from "./google.js";
import { OllamaAdapter } from "./ollama.js";
import { OpenAIAdapter } from "./openai.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";
import { TestAdapter } from "./test-adapter.js";
import type { ModelAdapter } from "./types.js";

/**
 * Adapter registry. The application never imports a provider SDK directly —
 * it asks this registry for the adapter matching a connection's providerType.
 * All six provider types are registered; streaming coverage is documented
 * per adapter (see IMPLEMENTATION_STATUS.md).
 */
export class ModelAdapterRegistry {
  private readonly adapters = new Map<ProviderType, ModelAdapter>();

  constructor() {
    const anthropic = new AnthropicAdapter();
    const openai = new OpenAIAdapter();
    const compatible = new OpenAICompatibleAdapter();
    const google = new GoogleAdapter();
    const ollama = new OllamaAdapter();
    const test = new TestAdapter();
    this.adapters.set(anthropic.providerType, anthropic);
    this.adapters.set(openai.providerType, openai);
    this.adapters.set("OPENAI_COMPATIBLE", compatible);
    this.adapters.set(google.providerType, google);
    this.adapters.set(ollama.providerType, ollama);
    this.adapters.set(test.providerType, test);
  }

  get(providerType: ProviderType): ModelAdapter | undefined {
    return this.adapters.get(providerType);
  }

  require(providerType: ProviderType): ModelAdapter {
    const adapter = this.adapters.get(providerType);
    if (!adapter) {
      throw errors.providerUnavailable(
        `Provider '${providerType}' does not have an adapter in this build`,
      );
    }
    return adapter;
  }

  list(): ModelAdapter[] {
    return Array.from(this.adapters.values());
  }
}
