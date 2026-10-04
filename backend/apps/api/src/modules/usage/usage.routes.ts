import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { getWorkspaceUsage } from "../../lib/billing.js";
import { getDailyReport, getMonthlyReport, detectAnomalies } from "./analytics.service.js";

/**
 * Token Usage API Routes.
 * Provides endpoints for tracking and retrieving token usage statistics.
 */
export default function registerUsageRoutes(app: FastifyInstance) {
  /**
   * Get token usage summary for the authenticated user.
   */
  app.get("/v1/usage", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage"],
      summary: "Get token usage summary for the user",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                inputTokens: { type: "integer" },
                outputTokens: { type: "integer" },
                totalTokens: { type: "integer" },
                estimatedCost: { type: "number" },
                totalCalls: { type: "integer" },
              },
            },
            requestId: { type: "string" },
          },
          required: ["data"],
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const query = (req.query ?? {}) as { workspaceId?: string; startDate?: string; endDate?: string };

    if (query.workspaceId) {
      await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");
    }

    const where: Record<string, unknown> = { userId };
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    const summary = await app.prisma.usageRecord.aggregate({
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      _count: true,
    });

    return ok(reply, {
      inputTokens: summary._sum.inputTokens ?? 0,
      outputTokens: summary._sum.outputTokens ?? 0,
      totalTokens: summary._sum.totalTokens ?? 0,
      estimatedCost: summary._sum.estimatedCost ?? 0,
      totalCalls: summary._count,
    });
  });

  /**
   * Get token usage breakdown by model.
   */
  app.get("/v1/usage/by-model", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage"],
      summary: "Get token usage breakdown by model",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  modelIdentifier: { type: "string" },
                  providerType: { type: "string" },
                  inputTokens: { type: "integer" },
                  outputTokens: { type: "integer" },
                  totalTokens: { type: "integer" },
                  estimatedCost: { type: "number" },
                  callCount: { type: "integer" },
                },
              },
            },
            requestId: { type: "string" },
          },
          required: ["data"],
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const query = (req.query ?? {}) as { workspaceId?: string; startDate?: string; endDate?: string };

    if (query.workspaceId) {
      await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");
    }

    const where: Record<string, unknown> = { userId };
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    const usage = await app.prisma.usageRecord.groupBy({
      by: ["modelIdentifier", "providerType"],
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
    });

    return ok(reply, usage.map((u) => ({
      modelIdentifier: u.modelIdentifier,
      providerType: u.providerType,
      inputTokens: u._sum.inputTokens ?? 0,
      outputTokens: u._sum.outputTokens ?? 0,
      totalTokens: u._sum.totalTokens ?? 0,
      estimatedCost: u._sum.estimatedCost ?? 0,
      callCount: u._count,
    })));
  });

  /**
   * Get token usage breakdown by task.
   */
  app.get("/v1/usage/by-task", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage"],
      summary: "Get token usage breakdown by task",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          limit: { type: "integer", default: 10 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  taskId: { type: ["string", "null"], format: "uuid" },
                  taskGoal: { type: "string" },
                  inputTokens: { type: "integer" },
                  outputTokens: { type: "integer" },
                  totalTokens: { type: "integer" },
                  estimatedCost: { type: "number" },
                  callCount: { type: "integer" },
                },
              },
            },
            requestId: { type: "string" },
          },
          required: ["data"],
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const query = (req.query ?? {}) as { workspaceId?: string; startDate?: string; endDate?: string; limit?: number };

    if (query.workspaceId) {
      await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");
    }

    const where: Record<string, unknown> = { userId };
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    const usage = await app.prisma.usageRecord.groupBy({
      by: ["taskId"],
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      _count: true,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: Math.min(query.limit ?? 10, 100),
    });

    // Fetch task details for non-null taskIds
    const taskIds = usage.filter((u) => u.taskId).map((u) => u.taskId!);
    const tasks = taskIds.length > 0
      ? await app.prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, goal: true },
        })
      : [];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    return ok(reply, usage.map((u) => ({
      taskId: u.taskId,
      taskGoal: u.taskId ? taskMap.get(u.taskId)?.goal ?? "Unknown" : "No task",
      inputTokens: u._sum.inputTokens ?? 0,
      outputTokens: u._sum.outputTokens ?? 0,
      totalTokens: u._sum.totalTokens ?? 0,
      estimatedCost: u._sum.estimatedCost ?? 0,
      callCount: u._count,
    })));
  });

  /**
   * Get daily token usage trend.
   */
  app.get("/v1/usage/trend", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage"],
      summary: "Get daily token usage trend",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          days: { type: "integer", default: 30 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string", format: "date" },
                  inputTokens: { type: "integer" },
                  outputTokens: { type: "integer" },
                  totalTokens: { type: "integer" },
                  estimatedCost: { type: "number" },
                  callCount: { type: "integer" },
                },
              },
            },
            requestId: { type: "string" },
          },
          required: ["data"],
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const query = (req.query ?? {}) as { workspaceId?: string; days?: number };
    const days = query.days ?? 30;

    if (query.workspaceId) {
      await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where: Record<string, unknown> = {
      userId,
      createdAt: { gte: startDate },
    };
    if (query.workspaceId) where.workspaceId = query.workspaceId;

    const usage = await app.prisma.usageRecord.findMany({
      where,
      select: {
        createdAt: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Group by date
    const dailyUsage = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number; callCount: number }>();
    
    for (const u of usage) {
      const date = u.createdAt.toISOString().split("T")[0]!;
      const existing = dailyUsage.get(date) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, callCount: 0 };
      existing.inputTokens += u.inputTokens;
      existing.outputTokens += u.outputTokens;
      existing.totalTokens += u.totalTokens;
      existing.estimatedCost += u.estimatedCost;
      existing.callCount += 1;
      dailyUsage.set(date, existing);
    }

    return ok(reply, Array.from(dailyUsage.entries()).map(([date, data]) => ({
      date,
      ...data,
    })));
  });

  // ── Cost Summary ──────────────────────────────────────────
  app.get("/v1/usage/cost-summary", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage", "costs"],
      summary: "Get cost summary with plan limits and quota",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId?: string };
    if (!query.workspaceId) {
      throw errors.validation("workspaceId is required");
    }
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const quota = await getWorkspaceUsage(app.prisma, query.workspaceId);

    return ok(reply, {
      plan: quota.plan,
      period: {
        start: quota.periodStart,
        end: quota.periodEnd,
      },
      tokens: {
        used: quota.monthlyTokens,
        limit: quota.monthlyTokensLimit,
        percentage: quota.monthlyTokensLimit > 0
          ? Math.round((quota.monthlyTokens / quota.monthlyTokensLimit) * 100)
          : 0,
      },
      cost: {
        used: Math.round(quota.monthlyCost * 100) / 100,
        limit: quota.monthlyCostLimit,
        percentage: quota.monthlyCostLimit > 0
          ? Math.round((quota.monthlyCost / quota.monthlyCostLimit) * 100)
          : 0,
      },
    });
  });

  // ── Cost Breakdown by Provider ────────────────────────────
  app.get("/v1/usage/cost-breakdown", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage", "costs"],
      summary: "Get cost breakdown by provider and model",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId?: string; startDate?: string; endDate?: string };
    if (!query.workspaceId) {
      throw errors.validation("workspaceId is required");
    }
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const where: Record<string, unknown> = { workspaceId: query.workspaceId };
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    const byProvider = await app.prisma.usageRecord.groupBy({
      by: ["providerType"],
      where,
      _sum: { estimatedCost: true, totalTokens: true },
      _count: true,
      orderBy: { _sum: { estimatedCost: "desc" } },
    });

    const byModel = await app.prisma.usageRecord.groupBy({
      by: ["modelIdentifier", "providerType"],
      where,
      _sum: { estimatedCost: true, totalTokens: true },
      _count: true,
      orderBy: { _sum: { estimatedCost: "desc" } },
    });

    const byStage = await app.prisma.usageRecord.groupBy({
      by: ["stage"],
      where,
      _sum: { estimatedCost: true, totalTokens: true },
      _count: true,
      orderBy: { _sum: { estimatedCost: "desc" } },
    });

    return ok(reply, {
      byProvider: byProvider.map((p) => ({
        providerType: p.providerType,
        estimatedCost: p._sum.estimatedCost ?? 0,
        totalTokens: p._sum.totalTokens ?? 0,
        callCount: p._count,
      })),
      byModel: byModel.map((m) => ({
        modelIdentifier: m.modelIdentifier,
        providerType: m.providerType,
        estimatedCost: m._sum.estimatedCost ?? 0,
        totalTokens: m._sum.totalTokens ?? 0,
        callCount: m._count,
      })),
      byStage: byStage.map((s) => ({
        stage: s.stage ?? "unknown",
        estimatedCost: s._sum.estimatedCost ?? 0,
        totalTokens: s._sum.totalTokens ?? 0,
        callCount: s._count,
      })),
    });
  });

  // ── Cost Alerts (workspace-level) ─────────────────────────
  app.get("/v1/usage/cost-alerts", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage", "costs"],
      summary: "List cost alerts for a workspace",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId: string };
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const alerts = await app.prisma.costAlert.findMany({
      where: { workspaceId: query.workspaceId },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, alerts);
  });

  // ── Daily Analytics Report ────────────────────────────────
  app.get("/v1/usage/analytics/daily", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage", "analytics"],
      summary: "Get daily analytics report for a workspace",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId: string; startDate?: string; endDate?: string };
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const startDate = query.startDate ? new Date(query.startDate) : (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d;
    })();

    const report = await getDailyReport(app.prisma, query.workspaceId, startDate, endDate);
    return ok(reply, report);
  });

  // ── Monthly Analytics Report ──────────────────────────────
  app.get("/v1/usage/analytics/monthly", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage", "analytics"],
      summary: "Get monthly analytics report for a workspace",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId", "year", "month"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          year: { type: "integer" },
          month: { type: "integer", minimum: 1, maximum: 12 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId: string; year: number; month: number };
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const report = await getMonthlyReport(
      app.prisma,
      query.workspaceId,
      query.year,
      query.month,
    );
    return ok(reply, report);
  });

  // ── Anomaly Detection ─────────────────────────────────────
  app.get("/v1/usage/anomalies", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage", "analytics"],
      summary: "Detect usage anomalies for a workspace",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId: string };
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const anomalies = await detectAnomalies(app.prisma, query.workspaceId);
    return ok(reply, {
      workspaceId: query.workspaceId,
      detectedAt: new Date().toISOString(),
      count: anomalies.length,
      anomalies,
    });
  });

  // ── Usage Quota ──────────────────────────────────────────
  app.get("/v1/usage/quota", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["usage", "billing"],
      summary: "Get workspace usage quota for current billing period",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId: string };
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");
    const quota = await getWorkspaceUsage(app.prisma, query.workspaceId);
    return ok(reply, quota);
  });
}
