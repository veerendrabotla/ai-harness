import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createProjectRequestSchema, updateProjectRequestSchema } from "@ai-harness/contracts";
import { errors } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

export default function registerProjectRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  app.get("/v1/workspaces/:workspaceId/projects", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["projects"],
      summary: "List projects in a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");
    const projects = await app.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return ok(reply, projects.map(toProjectDto));
  });

  app.post("/v1/workspaces/:workspaceId/projects", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["projects"],
      summary: "Create a new project",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");
    if ((await app.prisma.workspace.findUnique({ where: { id: workspaceId } }))?.status === "ARCHIVED") {
      throw errors.workspaceArchived();
    }
    const input = createProjectRequestSchema.parse(req.body);

    let bridgeId: string | null = null;
    if (input.connectionType === "LOCAL_BRIDGE") {
      if (!input.bridgeId) throw errors.validation("LOCAL_BRIDGE projects require bridgeId");
      const bridge = await app.prisma.bridge.findFirst({
        where: { id: input.bridgeId, status: "CONNECTED" },
      });
      if (!bridge) throw errors.bridgeDisconnected("The selected Local Bridge is not connected");
      const root = await app.prisma.bridgeProjectRoot.findFirst({
        where: { bridgeId: input.bridgeId, canonicalRootReference: input.rootReference },
      });
      if (!root) {
        // Never leak whether a path exists on someone's machine.
        throw errors.policyDenied("Root is not registered for this bridge");
      }
      bridgeId = input.bridgeId;
    }

    const project = await app.prisma.project.create({
      data: {
        id: randomUUID(),
        workspaceId,
        bridgeId,
        name: input.name,
        connectionType: input.connectionType,
        repositoryUrl: input.repositoryUrl ?? null,
        rootReference: input.rootReference,
        defaultBranch: input.defaultBranch ?? null,
        status: "AVAILABLE",
      },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "PROJECT_CREATED",
      entityType: "PROJECT",
      entityId: project.id,
    });
    return ok(reply, toProjectDto(project), 201);
  });

  app.get("/v1/projects/:projectId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await loadProjectScoped(app, req, projectId);
    return ok(reply, toProjectDto(project));
  });

  app.patch("/v1/projects/:projectId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await loadProjectScoped(app, req, projectId);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");
    const input = updateProjectRequestSchema.parse(req.body);
    const updated = await app.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.repositoryUrl !== undefined ? { repositoryUrl: input.repositoryUrl } : {}),
        ...(input.defaultBranch !== undefined ? { defaultBranch: input.defaultBranch } : {}),
      },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "PROJECT_UPDATED",
      entityType: "PROJECT",
      entityId: projectId,
    });
    return ok(reply, toProjectDto(updated));
  });

  app.delete("/v1/projects/:projectId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await loadProjectScoped(app, req, projectId);
    await app.requireWorkspaceRole(req, project.workspaceId, "OWNER");
    const activeTasks = await app.prisma.task.count({
      where: { projectId, state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
    });
    if (activeTasks > 0) throw errors.conflict("Project has active tasks; cancel them first");
    await app.prisma.project.delete({ where: { id: projectId } });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "PROJECT_DELETED",
      entityType: "PROJECT",
      entityId: projectId,
    });
    return ok(reply, { success: true });
  });
}

async function loadProjectScoped(
  app: FastifyInstance,
  req: Parameters<FastifyInstance["authenticate"]>[0],
  projectId: string,
) {
  const project = await app.prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw errors.notFound("Project");
  await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");
  return project;
}

function toProjectDto(p: {
  id: string;
  workspaceId: string;
  bridgeId: string | null;
  name: string;
  connectionType: string;
  repositoryUrl: string | null;
  rootReference: string;
  defaultBranch: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    bridgeId: p.bridgeId,
    name: p.name,
    connectionType: p.connectionType,
    repositoryUrl: p.repositoryUrl,
    rootReference: p.rootReference,
    defaultBranch: p.defaultBranch,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
