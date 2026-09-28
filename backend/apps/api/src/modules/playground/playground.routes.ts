/**
 * Playground Routes.
 * Run prompts against real AI providers via the model adapter registry.
 */
import type { FastifyInstance } from "fastify";
import { errors, getEnv } from "@ai-harness/shared";
import { resolveModelPricing } from "@ai-harness/contracts";
import { ModelAdapterRegistry, type ProviderConnectionRef } from "@ai-harness/model-adapters";
import { decryptSecret } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

const adapters = new ModelAdapterRegistry();

const MODEL_TO_PROVIDER: Record<string, string> = {
  "gpt-4o": "OPENAI",
  "gpt-4o-mini": "OPENAI",
  "gpt-3.5-turbo": "OPENAI",
  "claude-sonnet-4-20250514": "ANTHROPIC",
  "claude-3-5-haiku-20241022": "ANTHROPIC",
  "claude-3-opus-20240229": "ANTHROPIC",
  "gemini-2.0-flash": "GOOGLE",
  "gemini-1.5-pro": "GOOGLE",
  "deepseek-chat": "OPENAI_COMPATIBLE",
  "llama3": "OLLAMA",
  "mistral": "OLLAMA",
};

/** Playground pricing comes from the canonical table in @ai-harness/contracts. */
function playgroundPricing(model: string): { inputPrice: number; outputPrice: number } | undefined {
  const p = resolveModelPricing(model);
  return p ? { inputPrice: p.input, outputPrice: p.output } : undefined;
}

export default function registerPlaygroundRoutes(app: FastifyInstance) {
  /**
   * Run a prompt in the playground against a real AI provider.
   */
  app.post("/v1/playground/run", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["playground"],
      summary: "Run a prompt in the playground",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", minLength: 1 },
          systemPrompt: { type: "string" },
          model: { type: "string" },
          providerConnectionId: { type: "string", format: "uuid" },
          temperature: { type: "number", minimum: 0, maximum: 2 },
          maxTokens: { type: "integer", minimum: 1, maximum: 128000 },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const {
      prompt,
      systemPrompt = "You are a helpful assistant.",
      model = "gpt-4o",
      providerConnectionId,
      temperature = 0.7,
      maxTokens = 1024,
    } = req.body as {
      prompt: string;
      systemPrompt?: string;
      model?: string;
      providerConnectionId?: string;
      temperature?: number;
      maxTokens?: number;
    };

    if (!prompt?.trim()) throw errors.validation("Prompt is required");

    // Resolve provider connection
    const providerType = (MODEL_TO_PROVIDER[model] ?? "OPENAI") as "OPENAI" | "ANTHROPIC" | "GOOGLE" | "OLLAMA" | "OPENAI_COMPATIBLE";

    let connectionRef: ProviderConnectionRef | null = null;

    if (providerConnectionId) {
      // Use specified connection
      const conn = await app.prisma.providerConnection.findFirst({
        where: { id: providerConnectionId, userId, status: "ACTIVE" },
      });
      if (conn && conn.encryptedCredential) {
        const env = getEnv();
        connectionRef = {
          id: conn.id,
          providerType: conn.providerType,
          displayName: conn.displayName,
          credential: decryptSecret(Buffer.from(conn.encryptedCredential), env.ENCRYPTION_KEY),
        };
      }
    } else {
      // Find first active connection for this provider type
      const conn = await app.prisma.providerConnection.findFirst({
        where: { userId, providerType, status: "ACTIVE" },
      });
      if (conn && conn.encryptedCredential) {
        const env = getEnv();
        connectionRef = {
          id: conn.id,
          providerType: conn.providerType,
          displayName: conn.displayName,
          credential: decryptSecret(Buffer.from(conn.encryptedCredential), env.ENCRYPTION_KEY),
        };
      }
    }

    if (!connectionRef) {
      throw errors.providerUnavailable(
        `No active ${providerType} provider connection found. Add one in Settings > Providers.`,
      );
    }

    const adapter = adapters.get(connectionRef.providerType);
    if (!adapter) {
      throw errors.providerUnavailable(`No adapter registered for provider: ${connectionRef.providerType}`);
    }

    const startTime = Date.now();

    try {
      const result = await adapter.generate(
        {
          stage: "IMPLEMENTATION",
          modelIdentifier: model,
          systemInstructions: systemPrompt,
          userObjective: prompt,
          contextItems: "",
          responseSchemaName: "FREEFORM",
          maxOutputTokens: maxTokens,
          temperature,
        },
        connectionRef,
      );

      const usage = {
        input: result.usage.inputTokens ?? 0,
        output: result.usage.outputTokens ?? 0,
      };

      const pricing = playgroundPricing(model);
      let cost = 0;
      if (pricing) {
        cost = (usage.input * pricing.inputPrice + usage.output * pricing.outputPrice) / 1000;
      }

      return ok(reply, {
        content: result.text,
        model,
        tokens: usage,
        cost,
        duration: Date.now() - startTime,
        providerRequestId: result.providerRequestId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, `[Playground] Model call failed: ${message}`);
      throw errors.providerUnavailable(`Model call failed: ${message}`);
    }
  });

  /**
   * List available models across all connected providers.
   */
  app.get("/v1/playground/models", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["playground"],
      summary: "List available models for the playground",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const connections = await app.prisma.providerConnection.findMany({
      where: { userId, status: "ACTIVE" },
      select: { id: true, providerType: true, displayName: true },
    });

    const models: Array<{
      id: string;
      name: string;
      provider: string;
      providerConnectionId: string;
      pricing?: { inputPrice: number; outputPrice: number };
    }> = [];

    for (const conn of connections) {
      const providerModels = Object.entries(MODEL_TO_PROVIDER)
        .filter(([, provider]) => provider === conn.providerType)
        .map(([modelName]) => ({
          id: modelName,
          name: modelName,
          provider: conn.providerType,
          providerConnectionId: conn.id,
          pricing: playgroundPricing(modelName),
        }));
      models.push(...providerModels);
    }

    return ok(reply, { models });
  });
}
