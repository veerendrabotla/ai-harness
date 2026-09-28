import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

const renameSchema = z.object({
  goal: z.string().min(1).max(2000),
});

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  workspaceId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

/**
 * Session management API: rename, archive, search tasks.
 * Tasks ARE sessions in this architecture.
 */
export function registerSessionRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);
  // Rename a task/session
  app.patch("/v1/tasks/:taskId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const input = renameSchema.parse(req.body);

    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    const updated = await app.prisma.task.update({
      where: { id: taskId },
      data: { goal: input.goal },
    });

    return ok(reply, {
      id: updated.id,
      goal: updated.goal,
      state: updated.state,
      updatedAt: updated.updatedAt.toISOString(),
    });
  });

  // Search tasks/sessions
  app.post("/v1/tasks/search", { preHandler: [app.authenticate] }, async (req, reply) => {
    const input = searchSchema.parse(req.body);

    if (input.workspaceId) {
      await app.requireWorkspaceRole(req, input.workspaceId, "VIEWER");
    }

    const memberships = await app.prisma.workspaceMember.findMany({
      where: { userId: req.user!.sub },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    const where: Record<string, unknown> = {
      workspaceId: input.workspaceId ? input.workspaceId : { in: workspaceIds },
      goal: { contains: input.q, mode: "insensitive" },
    };

    const tasks = await app.prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: {
        id: true,
        goal: true,
        state: true,
        createdAt: true,
        updatedAt: true,
        workspaceId: true,
        projectId: true,
      },
    });

    return ok(reply, tasks.map((t) => ({
      id: t.id,
      goal: t.goal,
      state: t.state,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      workspaceId: t.workspaceId,
      projectId: t.projectId,
    })));
  });

  // Archive a task (soft-delete equivalent)
  app.post("/v1/tasks/:taskId/archive", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    if (task.archivedAt) {
      return ok(reply, { success: true, message: "Already archived" });
    }

    const updated = await app.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: task.workspaceId,
      action: "TASK_ARCHIVED",
      entityType: "TASK",
      entityId: taskId,
    });
    return ok(reply, { success: true, message: "Session archived", archivedAt: updated.archivedAt });
  });

  // Unarchive a task
  app.post("/v1/tasks/:taskId/unarchive", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    if (!task.archivedAt) {
      return ok(reply, { success: true, message: "Not archived" });
    }

    const updated = await app.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: null },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: task.workspaceId,
      action: "TASK_UNARCHIVED",
      entityType: "TASK",
      entityId: taskId,
    });
    return ok(reply, { success: true, message: "Session restored", archivedAt: updated.archivedAt });
  });
}
