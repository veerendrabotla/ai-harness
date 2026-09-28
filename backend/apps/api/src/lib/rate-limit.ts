/**
 * Per-user workspace rate limiting middleware.
 * Tracks API usage per user per workspace with configurable limits.
 * Uses Redis when available, falls back to in-memory.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import pino from "pino";
import { getSharedRedis } from "./redis.js";

const log = pino({ name: "rate-limit", level: "warn" });

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const inMemoryLimits = new Map<string, RateLimitEntry>();

function getRateLimitKey(userId: string, workspaceId: string, endpoint: string): string {
  return `ah:ratelimit:${userId}:${workspaceId}:${endpoint}`;
}

function getWindowStart(windowMs: number): number {
  const now = Date.now();
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Check rate limit for a user/workspace/endpoint combination.
 * Returns true if the request should be allowed, false if rate limited.
 */
export async function checkRateLimit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  userId: string,
  workspaceId: string,
  endpoint: string,
  windowMs: number = 60_000,
  maxRequests: number = 100,
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const windowStart = getWindowStart(windowMs);
  const key = getRateLimitKey(userId, workspaceId, endpoint);

  const redis = getSharedRedis();
  if (redis) {
    try {
      // Use Redis MULTI for atomic increment + expiry
      const multi = redis.multi();
      multi.incr(key);
      multi.pttl(key);
      const results = await multi.exec();
      const count = (results?.[0]?.[1] as number) ?? 1;
      const ttl = (results?.[1]?.[1] as number) ?? -1;

      // Set expiry on first request in window
      if (ttl === -2 || ttl === -1) {
        await redis.pexpire(key, windowMs);
      }

      if (count > maxRequests) {
        const retryAfter = Math.ceil(Math.max(0, (windowStart + windowMs - Date.now())) / 1000);
        return { allowed: false, remaining: 0, retryAfter: retryAfter || 1 };
      }

      return { allowed: true, remaining: Math.max(0, maxRequests - count) };
    } catch (err) {
      log.error({ err }, "[RateLimit] Redis failure, falling through to in-memory:");
    }
  }

  // In-memory fallback
  const entry = inMemoryLimits.get(key);
  if (entry && entry.windowStart === windowStart) {
    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((windowStart + windowMs - Date.now()) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }
    entry.count++;
    inMemoryLimits.set(key, entry);
    return { allowed: true, remaining: maxRequests - entry.count };
  }

  // New window or missing entry
  inMemoryLimits.set(key, { count: 1, windowStart });

  // Persist to database periodically (every 10th request per key)
  if (Math.random() < 0.1) {
    try {
      await prisma.rateLimit.upsert({
        where: {
          workspaceId_userId_endpoint_windowStart: {
            workspaceId,
            userId,
            endpoint,
            windowStart: new Date(windowStart),
          },
        },
        update: { currentCount: { increment: 1 } },
        create: {
          workspaceId,
          userId,
          endpoint,
          windowMs,
          maxRequests,
          currentCount: 1,
          windowStart: new Date(windowStart),
        },
      });
    } catch (err) {
      log.error({ err }, "[RateLimit] DB write failure, continuing with in-memory:");
    }
  }

  return { allowed: true, remaining: maxRequests - 1 };
}

/**
 * Fastify preHandler hook for per-user rate limiting.
 * Usage: app.addHook("preHandler", rateLimitHandler("tasks", 60_000, 50));
 */
export function rateLimitHandler(
  endpoint: string,
  windowMs: number = 60_000,
  maxRequests: number = 100,
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as { sub?: string } | undefined)?.sub;
    if (!userId) return; // Skip for unauthenticated requests

    const workspaceId = (req.params as { workspaceId?: string } | undefined)?.workspaceId;
    if (!workspaceId) return; // Skip if no workspace context

    const prisma = req.server.prisma;
    if (!prisma) return;

    const result = await checkRateLimit(prisma, userId, workspaceId, endpoint, windowMs, maxRequests);

    reply.header("X-RateLimit-Limit", maxRequests);
    reply.header("X-RateLimit-Remaining", result.remaining);

    if (!result.allowed) {
      reply.header("Retry-After", result.retryAfter ?? 60);
      reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
        },
      });
      return;
    }
  };
}

/**
 * Cleanup expired rate limit entries (call periodically).
 */
export function cleanupRateLimits(windowMs: number = 60_000): void {
  const cutoff = Date.now() - windowMs * 2;
  for (const [key, entry] of inMemoryLimits.entries()) {
    if (entry.windowStart < cutoff) {
      inMemoryLimits.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
if (typeof setInterval !== "undefined") {
  const cleanupTimer = setInterval(() => cleanupRateLimits(), CLEANUP_INTERVAL);
  cleanupTimer.unref();
}
