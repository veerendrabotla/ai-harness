import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import { Redis } from "ioredis";
import { getEnv } from "@ai-harness/shared";
import pino from "pino";

const log = pino({ name: "rate-limit-plugin", level: "warn" });

/**
 * Rate limiting (BACKEND_STRUCTURE.md §7).
 * Redis-backed when REDIS_URL is reachable; in-memory fallback for offline dev.
 * Per-route limits are configured at route registration time via config.rateLimit.
 * Per-user key generation is supported via `keyGenerator` in route config.
 */
export default fp(async function rateLimitPlugin(app) {
  const env = getEnv();
  let redis: Redis | undefined;
  let candidate: Redis | undefined;
  try {
    const client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    candidate = client;
    client.on("error", () => undefined); // permanent sink; failure surfaced via ready/error below
    // Wait for the socket to actually be ready before pinging: with
    // enableOfflineQueue:false an immediate ping() races the TCP connect and
    // fails deterministically ("Stream isn't writeable"), making production
    // boots think a healthy Redis was unreachable.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("redis connect timeout")), 3000);
      client.once("ready", () => {
        clearTimeout(timer);
        resolve();
      });
      client.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    await client.ping();
    redis = client;
  } catch (err) {
    log.error({ err }, "[Cache] Failed to connect to Redis:");
    candidate?.disconnect(); // stop background reconnects + avoid unhandled 'error'
    if (env.NODE_ENV === "production") {
      throw new Error("REDIS_URL must be reachable in production (Redis-backed rate limiting)");
    }
  }

  await app.register(rateLimit, {
    global: true,
    ...(redis ? { redis } : {}),
    nameSpace: "ah-rl:",
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.user?.sub ?? req.ip,
    addHeaders: { "x-ratelimit-limit": true, "x-ratelimit-remaining": true, "x-ratelimit-reset": true },
    // Per-route config.rateLimit overrides the global defaults; global:false routes had no protection.
  });

  app.addHook("onClose", async () => {
    redis?.disconnect();
  });
});
