/**
 * Task Template Routes.
 * Manage reusable task templates.
 */
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerTaskTemplateRoutes(app: FastifyInstance) {
  /**
   * List task templates for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/task-templates", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["task-templates"],
      summary: "List task templates",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const templates = await app.prisma.taskTemplate.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        description: true,
        goal: true,
        agentMode: true,
        config: true,
        usageCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { usageCount: "desc" },
    });

    return ok(reply, templates);
  });

  /**
   * Create a task template.
   */
  app.post<{
    Params: { workspaceId: string };
    Body: { name: string; description?: string; goal: string; agentMode: string; config?: Record<string, unknown> };
  }>("/v1/workspaces/:workspaceId/task-templates", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["task-templates"],
      summary: "Create a task template",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name", "goal", "agentMode"],
        properties: {
          name: { type: "string", maxLength: 200 },
          description: { type: "string" },
          goal: { type: "string", minLength: 1, maxLength: 5000 },
          agentMode: { type: "string", enum: ["BUILD", "PLAN", "ASK", "REVIEW", "FIX"] },
          config: { type: "object" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { name, description, goal, agentMode, config } = req.body as {
      name: string;
      description?: string;
      goal: string;
      agentMode: string;
      config?: Record<string, unknown>;
    };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const template = await app.prisma.taskTemplate.create({
      data: {
        workspaceId,
        name,
        description,
        goal,
        agentMode,
        config: config as Prisma.InputJsonValue,
      },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "TASK_TEMPLATE_CREATED",
      templateId: template.id,
      name,
    });

    return ok(reply, template, 201);
  });

  /**
   * Update a task template.
   */
  app.put<{
    Params: { workspaceId: string; templateId: string };
    Body: { name?: string; description?: string; goal?: string; agentMode?: string; config?: Record<string, unknown> };
  }>("/v1/workspaces/:workspaceId/task-templates/:templateId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["task-templates"],
      summary: "Update a task template",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const templateId = (req.params as { templateId: string }).templateId;
    const updates = req.body as {
      name?: string;
      description?: string;
      goal?: string;
      agentMode?: string;
      config?: Record<string, unknown>;
    };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const template = await app.prisma.taskTemplate.findUnique({
      where: { id: templateId, workspaceId },
    });
    if (!template) throw errors.notFound("Task template");

    const updated = await app.prisma.taskTemplate.update({
      where: { id: templateId },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.goal !== undefined && { goal: updates.goal }),
        ...(updates.agentMode !== undefined && { agentMode: updates.agentMode }),
        ...(updates.config !== undefined && { config: updates.config as Prisma.InputJsonValue }),
      },
    });

    return ok(reply, updated);
  });

  /**
   * Delete a task template.
   */
  app.delete<{
    Params: { workspaceId: string; templateId: string };
  }>("/v1/workspaces/:workspaceId/task-templates/:templateId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["task-templates"],
      summary: "Delete a task template",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const templateId = (req.params as { templateId: string }).templateId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    await app.prisma.taskTemplate.delete({
      where: { id: templateId, workspaceId },
    });

    return ok(reply, { success: true });
  });

  /**
   * Create a task from a template.
   */
  app.post<{
    Params: { workspaceId: string; templateId: string };
    Body: { projectId?: string; additionalGoal?: string };
  }>("/v1/workspaces/:workspaceId/task-templates/:templateId/use", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["task-templates"],
      summary: "Create a task from a template",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          projectId: { type: "string", format: "uuid" },
          additionalGoal: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const templateId = (req.params as { templateId: string }).templateId;
    const { projectId, additionalGoal } = req.body as { projectId?: string; additionalGoal?: string };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const template = await app.prisma.taskTemplate.findUnique({
      where: { id: templateId, workspaceId },
    });
    if (!template) throw errors.notFound("Task template");

    if (!projectId) throw errors.validation("projectId is required");

    // Increment usage count
    await app.prisma.taskTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    });

    const goal = additionalGoal ? `${template.goal}\n\nAdditional context: ${additionalGoal}` : template.goal;

    // Create the task
    const task = await app.prisma.task.create({
      data: {
        workspaceId,
        projectId,
        createdBy: req.user!.sub,
        goal,
        agentMode: template.agentMode as "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX",
        state: "QUEUED",
        selectedModelMode: "ROUTED",
      },
    });

    return ok(reply, {
      taskId: task.id,
      templateId,
      goal: task.goal,
      agentMode: task.agentMode,
    }, 201);
  });
}
