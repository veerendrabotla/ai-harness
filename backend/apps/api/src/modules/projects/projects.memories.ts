/**
 * Project Memory CRUD Routes.
 * Manage project-scoped memories (code conventions, decisions, patterns).
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

const VALID_CATEGORIES = [
  "architecture_decision",
  "coding_convention",
  "previous_bug",
  "user_preference",
  "deployment_config",
  "recurring_failure",
  "lesson_learned",
  "file_pattern",
  "dependency_note",
  "performance_note",
] as const;

const VALID_SOURCES = [
  "agent_observation",
  "user_input",
  "code_analysis",
  "error_pattern",
] as const;

export default function registerProjectMemoryRoutes(app: FastifyInstance) {
  /**
   * List memories for a project.
   */
  app.get<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/memories", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["project-memory"],
      summary: "List project memories",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { projectId } = req.params as { projectId: string };

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const memories = await app.prisma.projectMemory.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    return ok(reply, { memories });
  });

  /**
   * Create a project memory.
   */
  app.post<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/memories", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["project-memory"],
      summary: "Create a project memory",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["category", "key", "value", "context"],
        properties: {
          category: { type: "string", enum: [...VALID_CATEGORIES] },
          key: { type: "string", minLength: 1, maxLength: 255 },
          value: { type: "string" },
          context: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source: { type: "string", enum: [...VALID_SOURCES] },
          references: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { projectId } = req.params as { projectId: string };
    const body = req.body as {
      category: string;
      key: string;
      value: string;
      context: string;
      confidence?: number;
      source?: string;
      references?: string[];
    };

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const memory = await app.prisma.projectMemory.create({
      data: {
        projectId,
        category: body.category as typeof VALID_CATEGORIES[number],
        key: body.key,
        value: body.value,
        context: body.context,
        confidence: body.confidence ?? 0.5,
        source: (body.source ?? "agent_observation") as typeof VALID_SOURCES[number],
        references: JSON.stringify(body.references ?? []),
        lastAccessedAt: new Date(),
      },
    });

    return ok(reply, memory, 201);
  });

  /**
   * Update a project memory.
   */
  app.put<{
    Params: { projectId: string; memoryId: string };
  }>("/v1/projects/:projectId/memories/:memoryId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["project-memory"],
      summary: "Update a project memory",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { projectId, memoryId } = req.params as { projectId: string; memoryId: string };
    const body = req.body as Record<string, unknown>;

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const existing = await app.prisma.projectMemory.findFirst({
      where: { id: memoryId, projectId },
    });
    if (!existing) throw errors.notFound("Memory");

    const data: Record<string, unknown> = {};
    if (body.category) data.category = body.category;
    if (body.key) data.key = body.key;
    if (body.value) data.value = body.value;
    if (body.context) data.context = body.context;
    if (typeof body.confidence === "number") data.confidence = body.confidence;
    if (body.source) data.source = body.source;
    if (body.references) data.references = JSON.stringify(body.references);

    const updated = await app.prisma.projectMemory.update({
      where: { id: memoryId },
      data,
    });

    return ok(reply, updated);
  });

  /**
   * Delete a project memory.
   */
  app.delete<{
    Params: { projectId: string; memoryId: string };
  }>("/v1/projects/:projectId/memories/:memoryId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["project-memory"],
      summary: "Delete a project memory",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { projectId, memoryId } = req.params as { projectId: string; memoryId: string };

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const existing = await app.prisma.projectMemory.findFirst({
      where: { id: memoryId, projectId },
    });
    if (!existing) throw errors.notFound("Memory");

    await app.prisma.projectMemory.delete({ where: { id: memoryId } });
    return ok(reply, { success: true });
  });
}
