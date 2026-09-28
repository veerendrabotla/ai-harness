/**
 * Audit Log Routes.
 * Admin viewer for audit log entries.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

export default function registerAuditLogRoutes(app: FastifyInstance) {
  const adminPreHandler = [app.authenticate, app.requirePlatformAdmin];

  /**
   * List audit log entries (admin only).
   */
  app.get("/v1/admin/audit-logs", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "audit"],
      summary: "List audit log entries (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          userId: { type: "string", format: "uuid" },
          workspaceId: { type: "string", format: "uuid" },
          action: { type: "string" },
          entityType: { type: "string" },
          limit: { type: "integer", default: 50 },
          offset: { type: "integer", default: 0 },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as {
      userId?: string;
      workspaceId?: string;
      action?: string;
      entityType?: string;
      limit?: number;
      offset?: number;
      startDate?: string;
      endDate?: string;
    };
    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate && { gte: new Date(query.startDate) }),
        ...(query.endDate && { lte: new Date(query.endDate) }),
      };
    }

    const [entries, total] = await Promise.all([
      app.prisma.auditLogEntry.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          user: {
            select: { id: true, email: true, displayName: true },
          },
          workspace: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      app.prisma.auditLogEntry.count({ where }),
    ]);

    return ok(reply, { entries, total, limit, offset });
  });

  /**
   * Export audit log entries as CSV (admin only).
   */
  app.get("/v1/admin/audit-logs/export", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "audit"],
      summary: "Export audit log entries as CSV (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          userId: { type: "string", format: "uuid" },
          workspaceId: { type: "string", format: "uuid" },
          action: { type: "string" },
          entityType: { type: "string" },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as {
      userId?: string;
      workspaceId?: string;
      action?: string;
      entityType?: string;
      startDate?: string;
      endDate?: string;
    };

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate && { gte: new Date(query.startDate) }),
        ...(query.endDate && { lte: new Date(query.endDate) }),
      };
    }

    const entries = await app.prisma.auditLogEntry.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        ipAddress: true,
        createdAt: true,
        user: {
          select: { email: true, displayName: true },
        },
        workspace: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10000, // Limit export to 10k entries
    });

    // Generate CSV
    const headers = ["ID", "Action", "Entity Type", "Entity ID", "User Email", "User Name", "Workspace", "IP Address", "Created At"];
    const rows = entries.map((e) => [
      e.id,
      e.action,
      e.entityType,
      e.entityId ?? "",
      e.user?.email ?? "",
      e.user?.displayName ?? "",
      e.workspace?.name ?? "",
      e.ipAddress ?? "",
      e.createdAt.toISOString(),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");

    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().split("T")[0]}.csv"`);
    return reply.send(csv);
  });

  /**
   * Get audit log entry details (admin only).
   */
  app.get<{
    Params: { entryId: string };
  }>("/v1/admin/audit-logs/:entryId", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "audit"],
      summary: "Get audit log entry details (platform admin only)",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const entryId = (req.params as { entryId: string }).entryId;

    const entry = await app.prisma.auditLogEntry.findUnique({
      where: { id: entryId },
      include: {
        user: {
          select: { id: true, email: true, displayName: true },
        },
        workspace: {
          select: { id: true, name: true },
        },
      },
    });

    if (!entry) throw errors.notFound("Audit log entry");

    return ok(reply, entry);
  });

  /**
   * List audit logs for a workspace (workspace MEMBER or above).
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/audit-logs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["audit"],
      summary: "List audit logs for a workspace",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          action: { type: "string" },
          entityType: { type: "string" },
          limit: { type: "integer", default: 50 },
          offset: { type: "integer", default: 0 },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const query = (req.query ?? {}) as {
      action?: string;
      entityType?: string;
      limit?: number;
      offset?: number;
      startDate?: string;
      endDate?: string;
    };

    const where: Record<string, unknown> = { workspaceId };
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    const [entries, total] = await Promise.all([
      app.prisma.auditLogEntry.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: query.limit ?? 50,
        skip: query.offset ?? 0,
      }),
      app.prisma.auditLogEntry.count({ where }),
    ]);

    return ok(reply, { entries, total, limit: query.limit ?? 50, offset: query.offset ?? 0 });
  });
}
