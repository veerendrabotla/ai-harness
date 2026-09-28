/**
 * API Key Management Routes.
 * Workspace-level API key CRUD operations.
 */
import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `ai_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 10);
  return { key, hash, prefix };
}

export default function registerApiKeyRoutes(app: FastifyInstance) {
  /**
   * List API keys for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/api-keys", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["api-keys"],
      summary: "List API keys for workspace",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const keys = await app.prisma.apiKey.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, keys);
  });

  /**
   * Create a new API key.
   */
  app.post<{
    Params: { workspaceId: string };
    Body: { name: string; permissions?: Record<string, boolean>; expiresAt?: string };
  }>("/v1/workspaces/:workspaceId/api-keys", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["api-keys"],
      summary: "Create a new API key",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", maxLength: 100 },
          permissions: { type: "object" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { name, permissions, expiresAt } = req.body as {
      name: string;
      permissions?: Record<string, boolean>;
      expiresAt?: string;
    };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const { key, hash, prefix } = generateApiKey();

    const apiKey = await app.prisma.apiKey.create({
      data: {
        workspaceId,
        name,
        keyHash: hash,
        keyPrefix: prefix,
        permissions: permissions ?? {},
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "API_KEY_CREATED",
      keyName: name,
    });

    // Return the full key only on creation
    return ok(reply, {
      id: apiKey.id,
      name: apiKey.name,
      key,
      keyPrefix: prefix,
      createdAt: apiKey.createdAt,
    }, 201);
  });

  /**
   * Delete an API key.
   */
  app.delete<{
    Params: { workspaceId: string; keyId: string };
  }>("/v1/workspaces/:workspaceId/api-keys/:keyId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["api-keys"],
      summary: "Delete an API key",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const keyId = (req.params as { keyId: string }).keyId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    await app.prisma.apiKey.delete({
      where: { id: keyId, workspaceId },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "API_KEY_DELETED",
      keyId,
    });

    return ok(reply, { success: true });
  });

  /**
   * Rotate an API key (generates new key, marks old as expired).
   */
  app.post<{
    Params: { workspaceId: string; keyId: string };
  }>("/v1/workspaces/:workspaceId/api-keys/:keyId/rotate", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["api-keys"],
      summary: "Rotate an API key",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const keyId = (req.params as { keyId: string }).keyId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const existing = await app.prisma.apiKey.findFirst({
      where: { id: keyId, workspaceId },
    });
    if (!existing) throw errors.notFound("API key");

    // Mark old key as expired by setting expiry to now
    await app.prisma.apiKey.update({
      where: { id: keyId },
      data: { expiresAt: new Date() },
    });

    // Generate new key
    const { key, hash, prefix } = generateApiKey();
    await app.prisma.apiKey.create({
      data: {
        workspaceId,
        name: `${existing.name} (rotated)`,
        keyHash: hash,
        keyPrefix: prefix,
        permissions: existing.permissions as Prisma.InputJsonValue,
      },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "API_KEY_ROTATED",
      keyId,
    });

    return ok(reply, { key, prefix });
  });

  /**
   * Verify an API key (internal use).
   */
  app.post<{
    Body: { key: string };
  }>("/v1/api-keys/verify", {
    schema: {
      tags: ["api-keys"],
      summary: "Verify an API key",
    },
  }, async (req, reply) => {
    const { key } = req.body as { key: string };
    const hash = createHash("sha256").update(key).digest("hex");

    const apiKey = await app.prisma.apiKey.findUnique({
      where: { keyHash: hash },
      include: { workspace: { select: { id: true, name: true, status: true } } },
    });

    if (!apiKey) {
      throw errors.unauthenticated("Invalid API key");
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw errors.unauthenticated("API key has expired");
    }

    if (apiKey.workspace.status !== "ACTIVE") {
      throw errors.forbidden("Workspace is not active");
    }

    // Update last used timestamp
    await app.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return ok(reply, {
      valid: true,
      workspaceId: apiKey.workspaceId,
      permissions: apiKey.permissions,
    });
  });
}
