import type { FastifyInstance } from "fastify";
import { resolveModelPricing } from "@ai-harness/contracts";
import { ok } from "../../lib/http.js";

/** Pricing comes from the canonical table in @ai-harness/contracts. */
function withPricing<T extends { id: string }>(model: T): T & { inputPrice: number; outputPrice: number } {
  const p = resolveModelPricing(model.id);
  return { ...model, inputPrice: p?.input ?? 0, outputPrice: p?.output ?? 0 };
}

const PROVIDER_CATALOG = [
  {
    id: "openai",
    name: "OpenAI",
    type: "OPENAI",
    enabled: true,
    models: [
      { id: "gpt-4o", name: "GPT-4o", contextLength: 128000 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", contextLength: 128000 },
      { id: "o1", name: "o1", contextLength: 200000 },
      { id: "o1-mini", name: "o1 Mini", contextLength: 128000 },
      { id: "o3-mini", name: "o3 Mini", contextLength: 200000 },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", contextLength: 128000 },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", contextLength: 16385 },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "ANTHROPIC",
    enabled: true,
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextLength: 200000 },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", contextLength: 200000 },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextLength: 200000 },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus", contextLength: 200000 },
    ],
  },
  {
    id: "google",
    name: "Google AI",
    type: "GOOGLE",
    enabled: true,
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextLength: 1000000 },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextLength: 2000000 },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextLength: 1000000 },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    type: "OPENAI_COMPATIBLE",
    enabled: true,
    models: [
      { id: "mistral-large-latest", name: "Mistral Large", contextLength: 128000 },
      { id: "mistral-medium-latest", name: "Mistral Medium", contextLength: 32000 },
      { id: "codestral-latest", name: "Codestral", contextLength: 32000 },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "OPENAI_COMPATIBLE",
    enabled: true,
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", contextLength: 64000 },
      { id: "deepseek-coder", name: "DeepSeek Coder", contextLength: 64000 },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "OPENAI_COMPATIBLE",
    enabled: true,
    models: [
      { id: "meta-llama/llama-3.1-405b-instruct", name: "Llama 3.1 405B", contextLength: 131072 },
      { id: "meta-llama/llama-3.1-70b-instruct", name: "Llama 3.1 70B", contextLength: 131072 },
      { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", contextLength: 32768 },
    ],
  },
];

export default function registerModelProvidersRoutes(app: FastifyInstance) {
  app.get("/v1/models/providers", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["models"],
      summary: "List available AI model providers with models, pricing, and context limits",
    },
  }, async (_req, reply) => {
    return ok(reply, {
      providers: PROVIDER_CATALOG.map((p) => ({ ...p, models: p.models.map(withPricing) })),
    });
  });

  app.get("/v1/models", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["models"],
      summary: "List all available models across providers",
    },
  }, async (_req, reply) => {
    const models = PROVIDER_CATALOG.flatMap((p) =>
      p.models.map((m) => {
        const priced = withPricing(m);
        return {
          id: priced.id,
          name: priced.name,
          provider: p.name,
          providerId: p.id,
          contextLength: priced.contextLength,
          inputPrice: priced.inputPrice,
          outputPrice: priced.outputPrice,
        };
      }),
    );
    return ok(reply, { models });
  });
}
