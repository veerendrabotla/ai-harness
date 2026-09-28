import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import pino from "pino";
import { cacheSet, cacheInvalidate } from "./cache.js";

const log = pino({ name: "cache-middleware", level: "warn" });

export interface ResponseCacheOptions {
  /** TTL in seconds. Default 30. */
  ttlSeconds?: number;
  /** Only cache these status codes. Default [200]. */
  statusCodes?: number[];
  /** Custom key generator. Defaults to method + url + userId. */
  keyGenerator?: (req: FastifyRequest) => string;
  /** Patterns to invalidate after successful mutations. */
  invalidatePatterns?: string[];
}

function defaultKeyGenerator(req: FastifyRequest): string {
  const userId = req.user?.sub ?? "anon";
  return `${req.method}:${req.url}:${userId}`;
}

/**
 * Fastify hook that caches GET responses in Redis.
 * Attach via `app.addHook("onSend", responseCacheHook(opts))`.
 */
export function responseCacheHook(opts: ResponseCacheOptions = {}) {
  const {
    ttlSeconds = 30,
    statusCodes = [200],
    keyGenerator = defaultKeyGenerator,
  } = opts;

  return async function onSend(
    req: FastifyRequest,
    reply: FastifyReply,
    payload: string,
  ): Promise<string> {
    if (req.method !== "GET") return payload;
    if (!statusCodes.includes(reply.statusCode)) return payload;

    try {
      JSON.parse(payload);
      const cacheKey = `resp:${keyGenerator(req)}`;
      await cacheSet(cacheKey, { statusCode: reply.statusCode, payload }, ttlSeconds);
    } catch (err) {
      log.error({ err }, "[Cache] Non-JSON or uncacheable response:");
    }
    return payload;
  };
}

/**
 * Register the response caching plugin. GET responses are cached with a TTL.
 * Mutation routes (POST/PUT/PATCH/DELETE) automatically invalidate patterns
 * listed in their route config (`invalidateCachePatterns`).
 */
export async function registerCachePlugin(app: FastifyInstance) {
  // Cache GET responses
  app.addHook("onSend", responseCacheHook({ ttlSeconds: 30 }));

  // Invalidate cache on mutations
  app.addHook("onSend", async (req, _reply, payload) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.routeOptions?.config?.method as string)) {
      const patterns: string[] | undefined = (req.routeOptions?.config as unknown as Record<string, unknown>)
        ?.invalidateCachePatterns as string[] | undefined;
      if (patterns) {
        for (const pattern of patterns) {
          await cacheInvalidate(pattern);
        }
      }
    }
    return payload;
  });
}
