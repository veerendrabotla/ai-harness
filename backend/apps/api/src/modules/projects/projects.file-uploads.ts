/**
 * File Upload/Download Routes.
 * Multipart form data upload and binary file download via Bridge Gateway.
 */
import type { FastifyInstance } from "fastify";
import { BridgeGatewayClient, errors, getEnv } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

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

export function registerFileUploadRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  // Upload file via multipart form data
  app.post("/v1/projects/:projectId/files/upload", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["files"],
      summary: "Upload a file (multipart form data)",
      security: [{ bearerAuth: [] }],
      consumes: ["multipart/form-data"],
      params: {
        type: "object",
        required: ["projectId"],
        properties: { projectId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    // @fastify/multipart augments FastifyRequest when registered
    const data = await (req as unknown as { file(): Promise<{ filename: string; mimetype: string; filesize: number; file: AsyncIterable<Buffer> } | undefined> }).file();
    if (!data) {
      throw errors.validation("No file provided");
    }

    if (data.filesize > MAX_UPLOAD_SIZE) {
      throw errors.validation(`File exceeds maximum size of ${MAX_UPLOAD_SIZE / 1024 / 1024}MB`);
    }

    const filename = data.filename;
    const mimetype = data.mimetype;
    const filePath = (req.query as { path?: string }).path ?? filename;

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);
    const content = fileBuffer.toString("base64");

    const gw = makeGateway();
    const response = await gw.execute(
      bridge.id,
      "fs.write",
      { root: project.rootReference, path: filePath, content, encoding: "base64" },
      60_000,
    );
    if (!response.ok) {
      throw new Error(response.error?.message ?? "Failed to write file");
    }

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "FILE_UPLOADED",
      entityType: "FILE",
      entityId: projectId,
      metadata: { path: filePath, filename, mimetype, size: fileBuffer.length },
    });

    return ok(reply, {
      success: true,
      path: filePath,
      filename,
      mimetype,
      size: fileBuffer.length,
    });
  });

  // Download file as binary
  app.get("/v1/projects/:projectId/files/download", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["files"],
      summary: "Download a file as binary",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["projectId"],
        properties: { projectId: { type: "string", format: "uuid" } },
      },
      querystring: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
      },
    },
  }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const filePath = (req.query as { path: string }).path;
    if (!filePath) throw errors.validation("path query parameter is required");

    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const gw = makeGateway();
    const response = await gw.execute(
      bridge.id,
      "fs.read",
      { root: project.rootReference, path: filePath },
      60_000,
    );
    if (!response.ok) {
      throw new Error(response.error?.message ?? "Failed to read file");
    }

    const fileContent = (response.data as { content?: string })?.content ?? "";
    const buffer = Buffer.from(fileContent, "base64");

    const filename = filePath.split("/").pop() ?? filePath;
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      js: "application/javascript",
      ts: "application/typescript",
      json: "application/json",
      html: "text/html",
      css: "text/css",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      pdf: "application/pdf",
      zip: "application/zip",
      txt: "text/plain",
      md: "text/markdown",
    };
    const contentType = mimeMap[ext ?? ""] ?? "application/octet-stream";

    reply.header("Content-Type", contentType);
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.header("Content-Length", buffer.length);

    return reply.send(buffer);
  });
}
