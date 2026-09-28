/**
 * Audit Log Retention Routes.
 * Manage workspace-level audit log retention settings.
 */
import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

interface RetentionSettings {
  retentionDays: number;
  autoCleanup: boolean;
  lastCleanupAt: string | null;
}

const DEFAULT_RETENTION: RetentionSettings = {
  retentionDays: 90,
  autoCleanup: true,
  lastCleanupAt: null,
};

async function getRetentionSettings(
  app: FastifyInstance,
  workspaceId: string,
): Promise<RetentionSettings> {
  try {
    const row = await app.prisma.auditRetentionSetting.findUnique({
      where: { workspaceId },
      select: { settings: true },
    });

    if (row?.settings) {
      return { ...DEFAULT_RETENTION, ...(row.settings as Record<string, unknown>) };
    }
  } catch (err) {
    app.log.error({ err }, "[Audit] Failed to read retention settings:");
  }

  return { ...DEFAULT_RETENTION };
}

async function setRetentionSettings(
  app: FastifyInstance,
  workspaceId: string,
  settings: RetentionSettings,
): Promise<void> {
  try {
    const jsonSettings = JSON.parse(JSON.stringify(settings));
    await app.prisma.auditRetentionSetting.upsert({
      where: { workspaceId },
      update: { settings: jsonSettings },
      create: { workspaceId, settings: jsonSettings },
    });
  } catch (err) {
    app.log.error({ err }, "[Audit] Failed to save retention settings:");
  }
}

export default function registerAuditRetentionRoutes(app: FastifyInstance) {
  /**
   * Get audit log retention settings for workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/audit-retention", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["audit", "retention"],
      summary: "Get audit log retention settings",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const settings = await getRetentionSettings(app, workspaceId);

    return ok(reply, settings);
  });

  /**
   * Update audit log retention settings.
   */
  app.put<{
    Params: { workspaceId: string };
    Body: { retentionDays?: number; autoCleanup?: boolean };
  }>("/v1/workspaces/:workspaceId/audit-retention", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["audit", "retention"],
      summary: "Update audit log retention settings",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          retentionDays: { type: "integer", minimum: 7, maximum: 365 },
          autoCleanup: { type: "boolean" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { retentionDays, autoCleanup } = req.body as { retentionDays?: number; autoCleanup?: boolean };
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const current = await getRetentionSettings(app, workspaceId);
    const updated: RetentionSettings = {
      ...current,
      ...(retentionDays !== undefined && { retentionDays }),
      ...(autoCleanup !== undefined && { autoCleanup }),
    };

    await setRetentionSettings(app, workspaceId, updated);

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "AUDIT_RETENTION_UPDATED",
      retentionDays: updated.retentionDays,
      autoCleanup: updated.autoCleanup,
    });

    return ok(reply, updated);
  });

  /**
   * Trigger manual cleanup of old audit logs.
   */
  app.post<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/audit-retention/cleanup", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["audit", "retention"],
      summary: "Trigger manual audit log cleanup",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const settings = await getRetentionSettings(app, workspaceId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - settings.retentionDays);

    const result = await app.prisma.auditLogEntry.deleteMany({
      where: {
        workspaceId,
        createdAt: { lt: cutoffDate },
      },
    });

    const now = new Date().toISOString();
    await setRetentionSettings(app, workspaceId, {
      ...settings,
      lastCleanupAt: now,
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "AUDIT_LOG_CLEANUP",
      deleted: result.count,
      cutoffDate: cutoffDate.toISOString(),
    });

    return ok(reply, {
      deleted: result.count,
      cutoffDate: cutoffDate.toISOString(),
      retentionDays: settings.retentionDays,
    });
  });

  /**
   * Get audit log statistics for workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/audit-retention/stats", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["audit", "retention"],
      summary: "Get audit log statistics",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const settings = await getRetentionSettings(app, workspaceId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - settings.retentionDays);

    const [totalLogs, expiredLogs, oldestLog] = await Promise.all([
      app.prisma.auditLogEntry.count({ where: { workspaceId } }),
      app.prisma.auditLogEntry.count({
        where: { workspaceId, createdAt: { lt: cutoffDate } },
      }),
      app.prisma.auditLogEntry.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    return ok(reply, {
      totalLogs,
      expiredLogs,
      oldestLogAt: oldestLog?.createdAt?.toISOString() ?? null,
      retentionDays: settings.retentionDays,
      autoCleanup: settings.autoCleanup,
      lastCleanupAt: settings.lastCleanupAt,
    });
  });
}
