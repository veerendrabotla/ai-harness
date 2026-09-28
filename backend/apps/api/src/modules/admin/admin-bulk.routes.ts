/**
 * Admin Bulk Operations Routes.
 * Batch operations for platform admin.
 */
import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerAdminBulkRoutes(app: FastifyInstance) {
  const adminPreHandler = [app.authenticate, app.requirePlatformAdmin];

  /**
   * Bulk deactivate users.
   */
  app.post<{
    Body: { userIds: string[]; reason?: string };
  }>("/v1/admin/users/bulk/deactivate", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "bulk"],
      summary: "Bulk deactivate users (platform admin only)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["userIds"],
        properties: {
          userIds: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 100 },
          reason: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const { userIds, reason } = req.body as { userIds: string[]; reason?: string };

    const result = await app.prisma.user.updateMany({
      where: { id: { in: userIds }, status: { not: "SUSPENDED" } },
      data: { status: "SUSPENDED" },
    });

    await auditFromRequest(app.prisma, req, "ADMIN_USER_UPDATED", "USER", null, undefined, {
      action: "BULK_DEACTIVATE",
      count: result.count,
      userIds,
      reason,
    });

    return ok(reply, { deactivated: result.count });
  });

  /**
   * Bulk change workspace roles.
   */
  app.post<{
    Body: { workspaceId: string; changes: Array<{ userId: string; role: string }> };
  }>("/v1/admin/workspaces/bulk/roles", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "bulk"],
      summary: "Bulk change workspace roles (platform admin only)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workspaceId", "changes"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          changes: {
            type: "array",
            items: {
              type: "object",
              required: ["userId", "role"],
              properties: {
                userId: { type: "string", format: "uuid" },
                role: { type: "string", enum: ["OWNER", "MEMBER", "VIEWER"] },
              },
            },
            maxItems: 100,
          },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, changes } = req.body as {
      workspaceId: string;
      changes: Array<{ userId: string; role: string }>;
    };

    let updated = 0;
    for (const change of changes) {
      try {
        await app.prisma.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: change.userId } },
          data: { role: change.role as "OWNER" | "MEMBER" | "VIEWER" },
        });
        updated++;
      } catch (err) {
        req.log.error({ err }, "[Admin] Failed to update workspace member:");
      }
    }

    await auditFromRequest(app.prisma, req, "WORKSPACE_MEMBER_ADDED", "WORKSPACE", workspaceId, workspaceId, {
      action: "BULK_ROLE_CHANGE",
      count: updated,
      changes,
    });

    return ok(reply, { updated });
  });

  /**
   * Get bulk export of workspace data.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/admin/workspaces/:workspaceId/export", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "bulk"],
      summary: "Export workspace data (platform admin only)",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;

    const [workspace, members, projects, tasks] = await Promise.all([
      app.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true, description: true, status: true, createdAt: true },
      }),
      app.prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { userId: true, role: true, createdAt: true },
      }),
      app.prisma.project.findMany({
        where: { workspaceId },
        select: { id: true, name: true, status: true, createdAt: true },
      }),
      app.prisma.task.findMany({
        where: { workspaceId },
        select: { id: true, goal: true, state: true, createdAt: true },
        take: 1000,
      }),
    ]);

    return ok(reply, {
      workspace,
      members,
      projects,
      tasks,
      exportedAt: new Date().toISOString(),
    });
  });
}
