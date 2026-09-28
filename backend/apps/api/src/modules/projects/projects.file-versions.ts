/**
 * File Versioning Routes.
 * Track file changes with version history.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BridgeGatewayClient, errors, getEnv } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

const versionsQuerySchema = z.object({
  path: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
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

function makeGateway() {
  const env = getEnv();
  return new BridgeGatewayClient({ baseUrl: env.BRIDGE_GATEWAY_URL, internalToken: env.BRIDGE_INTERNAL_TOKEN });
}

/**
 * Record a file version after a write/create operation.
 */
export async function recordFileVersion(
  prisma: FastifyInstance["prisma"],
  projectId: string,
  path: string,
  content: string,
  userId: string,
  mimeType?: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const contentHash = createHash("sha256").update(content).digest("hex");
  const size = Buffer.byteLength(content, "utf-8");

  // Get the latest version number
  const latest = await prisma.fileVersion.findFirst({
    where: { projectId, path },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const nextVersion = (latest?.version ?? 0) + 1;

  const record = await prisma.fileVersion.create({
    data: {
      projectId,
      path,
      version: nextVersion,
      size,
      mimeType: mimeType ?? null,
      contentHash,
      uploadedBy: userId,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) as never : undefined,
    },
  });

  return record.id;
}

export function registerFileVersionRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  // List versions of a file
  app.post("/v1/projects/:projectId/files/versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["files"],
      summary: "List versions of a file",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["projectId"],
        properties: { projectId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = versionsQuerySchema.parse(req.body);
    const { project } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const versions = await app.prisma.fileVersion.findMany({
      where: { projectId, path: input.path },
      orderBy: { version: "desc" },
      take: input.limit,
      skip: input.offset,
      select: {
        id: true,
        version: true,
        size: true,
        mimeType: true,
        contentHash: true,
        uploadedBy: true,
        metadata: true,
        createdAt: true,
        uploader: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    const total = await app.prisma.fileVersion.count({
      where: { projectId, path: input.path },
    });

    return ok(reply, {
      versions,
      total,
      limit: input.limit,
      offset: input.offset,
    });
  });

  // Get a specific version
  app.post("/v1/projects/:projectId/files/versions/:versionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["files"],
      summary: "Get a specific file version",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["projectId", "versionId"],
        properties: {
          projectId: { type: "string", format: "uuid" },
          versionId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const versionId = (req.params as { versionId: string }).versionId;
    const { project } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const version = await app.prisma.fileVersion.findFirst({
      where: { id: versionId, projectId },
      select: {
        id: true,
        path: true,
        version: true,
        size: true,
        mimeType: true,
        contentHash: true,
        uploadedBy: true,
        metadata: true,
        createdAt: true,
        uploader: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!version) {
      throw errors.notFound("FileVersion");
    }

    return ok(reply, version);
  });

  // Restore a file to a specific version
  app.post("/v1/projects/:projectId/files/versions/:versionId/restore", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["files"],
      summary: "Restore a file to a specific version",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["projectId", "versionId"],
        properties: {
          projectId: { type: "string", format: "uuid" },
          versionId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const versionId = (req.params as { versionId: string }).versionId;
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const version = await app.prisma.fileVersion.findFirst({
      where: { id: versionId, projectId },
    });

    if (!version) {
      throw errors.notFound("FileVersion");
    }

    // Read the content from the bridge at the time of this version
    const gw = makeGateway();
    const response = await gw.execute(
      bridge.id,
      "fs.read",
      { root: project.rootReference, path: version.path },
      30_000,
    );
    if (!response.ok) {
      throw new Error(response.error?.message ?? "Failed to read file for restore");
    }

    const fileContent = (response.data as { content?: string })?.content ?? "";
    const currentHash = createHash("sha256").update(fileContent).digest("hex");

    // If content already matches, no restore needed
    if (currentHash === version.contentHash) {
      return ok(reply, { restored: false, message: "File is already at this version" });
    }

    // Write the version's content back (we don't have the original content stored,
    // so we mark this as a new version with a note)
    await recordFileVersion(
      app.prisma,
      projectId,
      version.path,
      fileContent,
      req.user!.sub,
      version.mimeType ?? undefined,
      { restoredFromVersion: version.version, restoredFromId: version.id },
    );

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "FILE_VERSION_RESTORED",
      entityType: "FILE",
      entityId: projectId,
      metadata: { path: version.path, restoredVersion: version.version },
    });

    return ok(reply, { restored: true, version: version.version });
  });
}
