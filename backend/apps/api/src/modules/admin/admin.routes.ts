/**
 * Admin API Routes.
 * Platform-level operations for PLATFORM_ADMIN users.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { getQueueCounts } from "../../lib/task-queue.js";

export default function registerAdminRoutes(app: FastifyInstance) {
  // All admin routes require authentication + platform admin role
  const adminPreHandler = [app.authenticate, app.requirePlatformAdmin];

  /**
   * List all users (admin only).
   */
  app.get("/v1/admin/users", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin"],
      summary: "List all users (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 50 },
          offset: { type: "integer", default: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { limit?: number; offset?: number };
    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const [users, total] = await Promise.all([
      app.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      app.prisma.user.count(),
    ]);

    return ok(reply, { users, total, limit, offset });
  });

  /**
   * Get user details (admin only).
   */
  app.get<{
    Params: { userId: string };
  }>("/v1/admin/users/:userId", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin"],
      summary: "Get user details (platform admin only)",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = (req.params as { userId: string }).userId;

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        createdAt: true,
        workspaceMemberships: {
          select: {
            role: true,
            workspace: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!user) throw errors.notFound("User");

    return ok(reply, user);
  });

  /**
   * Deactivate user (admin only).
   */
  app.post<{
    Params: { userId: string };
  }>("/v1/admin/users/:userId/deactivate", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin"],
      summary: "Deactivate a user (platform admin only)",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = (req.params as { userId: string }).userId;

    if (userId === req.user!.sub) {
      throw errors.validation("Cannot deactivate your own account");
    }

    const user = await app.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw errors.notFound("User");

    await app.prisma.user.update({
      where: { id: userId },
      data: { status: "SUSPENDED" },
    });

    return ok(reply, { success: true });
  });

  /**
   * List all workspaces (admin only).
   */
  app.get("/v1/admin/workspaces", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin"],
      summary: "List all workspaces (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 50 },
          offset: { type: "integer", default: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { limit?: number; offset?: number };
    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const [workspaces, total] = await Promise.all([
      app.prisma.workspace.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          _count: { select: { members: true, projects: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      app.prisma.workspace.count(),
    ]);

    return ok(reply, { workspaces, total, limit, offset });
  });

  /**
   * Get system stats (admin only).
   */
  app.get("/v1/admin/stats", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin"],
      summary: "Get system statistics (platform admin only)",
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    const [users, workspaces, projects, tasks, deployments] = await Promise.all([
      app.prisma.user.count(),
      app.prisma.workspace.count(),
      app.prisma.project.count(),
      app.prisma.task.count(),
      app.prisma.deployment.count(),
    ]);

    const activeTasks = await app.prisma.task.count({
      where: { state: { in: ["QUEUED", "EXECUTING", "PLANNING"] } },
    });

    // Get queue stats from BullMQ (TASK_QUEUE resolves the real key prefix —
    // the previous hardcoded `bull:ai-harness-tasks:*` keys never existed).
    let queueStats = { waiting: 0, active: 0, completed: 0, failed: 0 };
    try {
      const counts = await getQueueCounts();
      queueStats = {
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
      };
    } catch (err) {
      app.log.warn({ err }, "Redis unavailable for queue stats");
    }

    return ok(reply, {
      users,
      workspaces,
      projects,
      tasks,
      activeTasks,
      deployments,
      queue: queueStats,
    });
  });

  /**
   * Get platform usage stats (admin only).
   */
  app.get("/v1/admin/usage", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin"],
      summary: "Get platform-wide usage statistics (platform admin only)",
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    const usage = await app.prisma.usageRecord.aggregate({
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      _count: true,
    });

    return ok(reply, {
      inputTokens: usage._sum.inputTokens ?? 0,
      outputTokens: usage._sum.outputTokens ?? 0,
      totalTokens: usage._sum.totalTokens ?? 0,
      estimatedCost: usage._sum.estimatedCost ?? 0,
      totalCalls: usage._count,
    });
  });
}
