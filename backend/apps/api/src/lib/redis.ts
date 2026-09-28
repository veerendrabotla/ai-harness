/**
 * Shared Redis connection for route handlers.
 * Avoids creating per-request connections that leak under load.
 */
import { Redis } from "ioredis";
import { getEnv } from "@ai-harness/shared";
import pino from "pino";

const log = pino({ name: "redis", level: "warn" });

let sharedRedis: Redis | null = null;

export function getSharedRedis(): Redis | null {
  if (sharedRedis) return sharedRedis;
  try {
    const env = getEnv();
    sharedRedis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: false,
    });
    sharedRedis.on("error", (err) => {
      log.error({ err }, "[Redis] Connection error:");
    });
    return sharedRedis;
  } catch (err) {
    log.error({ err }, "[Cache] Failed to create Redis connection:");
    return null;
  }
}
