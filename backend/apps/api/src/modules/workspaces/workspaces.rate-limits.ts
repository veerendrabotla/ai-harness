/**
 * Rate Limit Configuration Routes.
 * Manage per-user workspace API rate limits.
 */
import type { FastifyInstance } from "fastify";
import pino from "pino";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

const log = pino({ name: "workspaces-rate-limits", level: "warn" });

const DEFAULT_RATE_LIMITS = {
  enabled: true,
  global: { windowMs: 60_000, maxRequests: 100 },
  endpoints: {
    tasks: { windowMs: 60_000, maxRequests: 30 },
    providers: { windowMs: 60_000, maxRequests: 20 },
    deploy: { windowMs: 300_000, maxRequests: 10 },
  },
};

// In-memory config store (persists across requests within same server instance)
const rateLimitConfigStore = new Map<string, typeof DEFAULT_RATE_LIMITS>();

async function getRateLimitConfig(
  prisma: FastifyInstance["prisma"],
  workspaceId: string,
): Promise<typeof DEFAULT_RATE_LIMITS> {
  // Check in-memory store first
  const cached = rateLimitConfigStore.get(workspaceId);
  if (cached) return cached;

  // Try to read from workspace policy metadata
  try {
    const policy = await prisma.workspacePolicy.findUnique({
      where: { workspaceId },
    });
    if (policy) {
      // Use policy fields as rate limit config
      const config = {
        ...DEFAULT_RATE_LIMITS,
        global: {
          windowMs: 60_000,
          maxRequests: policy.maxToolCallsPerRun * 2,
        },
      };
      rateLimitConfigStore.set(workspaceId, config);
      return config;
    }
  } catch (err) {
    log.error({ err }, "[RateLimit] Failed to read config from DB:");
  }

  return { ...DEFAULT_RATE_LIMITS };
}

export default function registerRateLimitRoutes(app: FastifyInstance) {
  /**
   * Get rate limit configuration for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/rate-limits", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["rate-limits"],
      summary: "Get workspace rate limit configuration",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const config = await getRateLimitConfig(app.prisma, workspaceId);
    return ok(reply, config);
  });

  /**
   * Update rate limit configuration for a workspace.
   */
  app.put<{
    Params: { workspaceId: string };
    Body: {
      enabled?: boolean;
      global?: { windowMs?: number; maxRequests?: number };
      endpoints?: Record<string, { windowMs?: number; maxRequests?: number }>;
    };
  }>("/v1/workspaces/:workspaceId/rate-limits", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["rate-limits"],
      summary: "Update workspace rate limit configuration",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          global: {
            type: "object",
            properties: {
              windowMs: { type: "integer", minimum: 1000 },
              maxRequests: { type: "integer", minimum: 1 },
            },
          },
          endpoints: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                windowMs: { type: "integer", minimum: 1000 },
                maxRequests: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const body = req.body as {
      enabled?: boolean;
      global?: { windowMs?: number; maxRequests?: number };
      endpoints?: Record<string, { windowMs?: number; maxRequests?: number }>;
    };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    // Merge with existing config
    const existing = await getRateLimitConfig(app.prisma, workspaceId);
    const updated = {
      ...existing,
      ...(typeof body.enabled === "boolean" && { enabled: body.enabled }),
      ...(body.global && { global: { ...existing.global, ...body.global } }),
      ...(body.endpoints && {
        endpoints: {
          ...existing.endpoints,
          ...body.endpoints,
        },
      }),
    };

    rateLimitConfigStore.set(workspaceId, updated);

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "RATE_LIMIT_CONFIG_UPDATED",
      config: updated,
    });

    return ok(reply, updated);
  });

  /**
   * Get current rate limit usage for a user in a workspace.
   */
  app.get<{
    Params: { workspaceId: string; userId: string };
  }>("/v1/workspaces/:workspaceId/rate-limits/usage/:userId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["rate-limits"],
      summary: "Get rate limit usage for a user",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const userId = (req.params as { userId: string }).userId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const recentEntries = await app.prisma.rateLimit.findMany({
      where: {
        workspaceId,
        userId,
        windowStart: { gte: new Date(Date.now() - 3600_000) },
      },
      orderBy: { windowStart: "desc" },
      take: 50,
    });

    return ok(reply, recentEntries);
  });

  /**
   * Get aggregated rate limit usage across all users in a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/rate-limits/usage", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["rate-limits"],
      summary: "Get aggregated rate limit usage for a workspace",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const recentEntries = await app.prisma.rateLimit.groupBy({
      by: ["userId", "endpoint"],
      where: {
        workspaceId,
        windowStart: { gte: new Date(Date.now() - 3600_000) },
      },
      _sum: { currentCount: true },
      orderBy: { _sum: { currentCount: "desc" } },
      take: 50,
    });

    return ok(reply, recentEntries);
  });
}
