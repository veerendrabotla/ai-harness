import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BridgeGatewayClient, errors, getEnv } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";
import { recordFileVersion } from "./projects.file-versions.js";

const listSchema = z.object({
  path: z.string().default("."),
});

const readSchema = z.object({
  path: z.string().min(1),
});

const writeSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(2_000_000),
});

const createSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(2_000_000).default(""),
  type: z.enum(["file", "directory"]).default("file"),
});

const renameSchema = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
});

const deleteSchema = z.object({
  path: z.string().min(1),
});

const searchSchema = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().default("."),
  maxResults: z.number().int().min(1).max(200).default(50),
});

async function resolveBridge(projectId: string, prisma: FastifyInstance["prisma"]) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { bridge: true },
  });
  if (!project) throw errors.notFound("Project");
  if (project.connectionType !== "LOCAL_BRIDGE" || !project.bridgeId || !project.bridge) {
    throw errors.projectUnavailable("File operations require a Local Bridge project");
  }
  if (project.bridge.status !== "CONNECTED") {
    throw errors.bridgeDisconnected("The bridge owning this project is not connected");
  }
  return { project, bridge: project.bridge };
}

function gateway(_app: FastifyInstance) {
  const env = getEnv();
  return new BridgeGatewayClient({ baseUrl: env.BRIDGE_GATEWAY_URL, internalToken: env.BRIDGE_INTERNAL_TOKEN });
}

/**
 * Standalone file operations API for the IDE file explorer.
 * These go through the Bridge Gateway — the browser never touches the filesystem directly.
 */
export function registerFileRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  // List directory contents
  app.post("/v1/projects/:projectId/files/list", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = listSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const gw = gateway(app);
    const response = await gw.execute(bridge.id, "fs.list", { root: project.rootReference, path: input.path }, 30_000);
    if (!response.ok) throw makeBridgeError(response.error);
    return ok(reply, response.data ?? {});
  });

  // Read file content
  app.post("/v1/projects/:projectId/files/read", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = readSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const gw = gateway(app);
    const response = await gw.execute(bridge.id, "fs.read", { root: project.rootReference, path: input.path }, 30_000);
    if (!response.ok) throw makeBridgeError(response.error);
    return ok(reply, response.data ?? {});
  });

  // Write file content
  app.post("/v1/projects/:projectId/files/write", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = writeSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const gw = gateway(app);
    const response = await gw.execute(bridge.id, "fs.write", { root: project.rootReference, path: input.path, content: input.content }, 30_000);
    if (!response.ok) throw makeBridgeError(response.error);

    // Record file version
    await recordFileVersion(app.prisma, projectId, input.path, input.content, req.user!.sub);

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "FILE_WRITTEN",
      entityType: "FILE",
      entityId: projectId,
      metadata: { path: input.path },
    });
    return ok(reply, { success: true });
  });

  // Create file or directory
  app.post("/v1/projects/:projectId/files/create", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = createSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const gw = gateway(app);
    const kind = input.type === "directory" ? "fs.mkdir" : "fs.create";
    const response = await gw.execute(bridge.id, kind, { root: project.rootReference, path: input.path, content: input.content }, 30_000);
    if (!response.ok) throw makeBridgeError(response.error);

    // Record file version (only for files, not directories)
    if (input.type === "file" && input.content) {
      await recordFileVersion(app.prisma, projectId, input.path, input.content, req.user!.sub);
    }

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "FILE_CREATED",
      entityType: "FILE",
      entityId: projectId,
      metadata: { path: input.path, type: input.type },
    });
    return ok(reply, { success: true });
  });

  // Rename/move file
  app.post("/v1/projects/:projectId/files/rename", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = renameSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const gw = gateway(app);
    const response = await gw.execute(bridge.id, "fs.rename", { root: project.rootReference, oldPath: input.oldPath, newPath: input.newPath }, 30_000);
    if (!response.ok) throw makeBridgeError(response.error);

    // Record rename in version history (create a new version entry for the new path with RENAMED metadata)
    await recordFileVersion(app.prisma, projectId, input.newPath, "", req.user!.sub, undefined, { operation: "renamed", from: input.oldPath });

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "FILE_RENAMED",
      entityType: "FILE",
      entityId: projectId,
      metadata: { oldPath: input.oldPath, newPath: input.newPath },
    });
    return ok(reply, { success: true });
  });

  // Delete file
  app.post("/v1/projects/:projectId/files/delete", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = deleteSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const gw = gateway(app);
    const response = await gw.execute(bridge.id, "fs.delete", { root: project.rootReference, path: input.path }, 30_000);
    if (!response.ok) throw makeBridgeError(response.error);

    // Record deletion in version history
    await recordFileVersion(app.prisma, projectId, input.path, "", req.user!.sub, undefined, { operation: "deleted" });

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "FILE_DELETED",
      entityType: "FILE",
      entityId: projectId,
      metadata: { path: input.path },
    });
    return ok(reply, { success: true });
  });

  // Search file contents
  app.post("/v1/projects/:projectId/files/search", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = searchSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const gw = gateway(app);
    const response = await gw.execute(bridge.id, "fs.search", { root: project.rootReference, path: input.path, pattern: input.pattern, maxResults: input.maxResults }, 30_000);
    if (!response.ok) throw makeBridgeError(response.error);
    return ok(reply, response.data ?? {});
  });
}

import { AppError, ERROR_CODES } from "@ai-harness/shared";
function makeBridgeError(error?: { code?: string; message?: string }): AppError {
  const code = error?.code ?? "INTERNAL_ERROR";
  const safeCode = (ERROR_CODES as readonly string[]).includes(code)
    ? (code as (typeof ERROR_CODES)[number])
    : "INTERNAL_ERROR";
  return new AppError(safeCode, error?.message ?? "Bridge call failed");
}
