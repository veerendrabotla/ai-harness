/**
 * Simple Redis-backed query cache for hot paths.
 * Provides TTL-based caching with automatic invalidation.
 */
import { Redis } from "ioredis";
import { getEnv } from "@ai-harness/shared";
import pino from "pino";

const log = pino({ name: "cache", level: "warn" });

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  try {
    const env = getEnv();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableReadyCheck: false,
    });
    redis.on("error", () => undefined);
    return redis;
  } catch (err) {
    log.error({ err }, "[Cache] Redis connection failed:");
    return null;
  }
}

/**
 * Get a cached value by key.
 * Returns null if not found or expired.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(`cache:${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log.error({ err }, "[Cache] Cache get failed:");
    return null;
  }
}

/**
 * Set a cached value with TTL.
 * @param key Cache key
 * @param value Value to cache
 * @param ttlSeconds Time to live in seconds (default 60)
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.setex(`cache:${key}`, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    log.error({ err }, "[Cache] Cache set failed:");
  }
}

/**
 * Invalidate cached values by pattern.
 * @param pattern Pattern to match (e.g., "tasks:workspace:*")
 */
export async function cacheInvalidate(pattern: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await r.scan(cursor, "MATCH", `cache:${pattern}`, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) await r.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    log.error({ err }, "[Cache] Cache invalidation failed:");
  }
}

/**
 * Wrap a function with caching.
 * @param key Cache key
 * @param ttlSeconds TTL in seconds
 * @param fn Function to cache
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const result = await fn();
  await cacheSet(key, result, ttlSeconds);
  return result;
}
