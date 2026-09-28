/**
 * Task Branch Routes.
 * Manage task execution branches.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

export default function registerTaskBranchRoutes(app: FastifyInstance) {
  /**
   * List branches for a task.
   */
  app.get<{
    Params: { taskId: string };
  }>("/v1/tasks/:taskId/branches", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks", "branches"],
      summary: "List task branches",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const taskId = (req.params as { taskId: string }).taskId;

    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspaceId: true },
    });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    const branches = await app.prisma.taskBranch.findMany({
      where: { taskId },
      select: {
        id: true,
        name: true,
        parentRunId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, branches);
  });

  /**
   * Create a task branch.
   */
  app.post<{
    Params: { taskId: string };
    Body: { name: string; parentRunId?: string };
  }>("/v1/tasks/:taskId/branches", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks", "branches"],
      summary: "Create a task branch",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", maxLength: 100 },
          parentRunId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const taskId = (req.params as { taskId: string }).taskId;
    const { name, parentRunId } = req.body as { name: string; parentRunId?: string };

    // Verify task exists
    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspaceId: true },
    });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    // Check for duplicate branch name
    const existing = await app.prisma.taskBranch.findFirst({
      where: { taskId, name },
    });
    if (existing) throw errors.validation("Branch name already exists");

    const branch = await app.prisma.taskBranch.create({
      data: {
        taskId,
        name,
        parentRunId,
      },
    });

    return ok(reply, branch, 201);
  });

  /**
   * Update branch status.
   */
  app.patch<{
    Params: { taskId: string; branchId: string };
    Body: { status: string };
  }>("/v1/tasks/:taskId/branches/:branchId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks", "branches"],
      summary: "Update branch status",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["ACTIVE", "MERGED", "ABANDONED"] },
        },
      },
    },
  }, async (req, reply) => {
    const taskId = (req.params as { taskId: string }).taskId;
    const branchId = (req.params as { branchId: string }).branchId;
    const { status } = req.body as { status: string };

    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspaceId: true },
    });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    const branch = await app.prisma.taskBranch.findUnique({
      where: { id: branchId, taskId },
    });
    if (!branch) throw errors.notFound("Branch");

    const updated = await app.prisma.taskBranch.update({
      where: { id: branchId },
      data: { status },
    });

    return ok(reply, updated);
  });

  /**
   * Delete a task branch.
   */
  app.delete<{
    Params: { taskId: string; branchId: string };
  }>("/v1/tasks/:taskId/branches/:branchId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks", "branches"],
      summary: "Delete a task branch",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const taskId = (req.params as { taskId: string }).taskId;
    const branchId = (req.params as { branchId: string }).branchId;

    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspaceId: true },
    });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    await app.prisma.taskBranch.delete({
      where: { id: branchId, taskId },
    });

    return ok(reply, { success: true });
  });
}
