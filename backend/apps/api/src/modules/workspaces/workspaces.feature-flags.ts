/**
 * Feature Flags Routes.
 * Workspace-level feature flag management.
 */
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerFeatureFlagRoutes(app: FastifyInstance) {
  /**
   * List feature flags for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/feature-flags", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["feature-flags"],
      summary: "List feature flags",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const flags = await app.prisma.featureFlag.findMany({
      where: { workspaceId },
      select: {
        id: true,
        key: true,
        enabled: true,
        config: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { key: "asc" },
    });

    return ok(reply, flags);
  });

  /**
   * Create or update a feature flag.
   */
  app.post<{
    Params: { workspaceId: string };
    Body: { key: string; enabled?: boolean; config?: Record<string, unknown> };
  }>("/v1/workspaces/:workspaceId/feature-flags", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["feature-flags"],
      summary: "Create or update a feature flag",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["key"],
        properties: {
          key: { type: "string", maxLength: 100, pattern: "^[a-z0-9_-]+$" },
          enabled: { type: "boolean", default: false },
          config: { type: "object" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { key, enabled = false, config = {} } = req.body as {
      key: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    };

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const flag = await app.prisma.featureFlag.upsert({
      where: {
        workspaceId_key: { workspaceId, key },
      },
      update: { enabled, config: config as Prisma.InputJsonValue },
      create: { workspaceId, key, enabled, config: config as Prisma.InputJsonValue },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "FEATURE_FLAG_UPDATED",
      flagKey: key,
      enabled,
    });

    return ok(reply, {
      id: flag.id,
      key: flag.key,
      enabled: flag.enabled,
      config: flag.config,
      createdAt: flag.createdAt,
      updatedAt: flag.updatedAt,
    });
  });

  /**
   * Delete a feature flag.
   */
  app.delete<{
    Params: { workspaceId: string; flagId: string };
  }>("/v1/workspaces/:workspaceId/feature-flags/:flagId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["feature-flags"],
      summary: "Delete a feature flag",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const flagId = (req.params as { flagId: string }).flagId;

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    await app.prisma.featureFlag.delete({
      where: { id: flagId, workspaceId },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "FEATURE_FLAG_DELETED",
      flagId,
    });

    return ok(reply, { success: true });
  });

  /**
   * Check if a feature flag is enabled (public endpoint for client-side checks).
   */
  app.get<{
    Params: { workspaceId: string; key: string };
  }>("/v1/workspaces/:workspaceId/feature-flags/:key", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["feature-flags"],
      summary: "Check feature flag status",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const key = (req.params as { key: string }).key;

    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const flag = await app.prisma.featureFlag.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
      select: { enabled: true, config: true },
    });

    return ok(reply, {
      enabled: flag?.enabled ?? false,
      config: flag?.config ?? {},
    });
  });
}
