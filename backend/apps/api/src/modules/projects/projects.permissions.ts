/**
 * Project Team Permission Routes.
 * Manage per-project team permissions.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerProjectPermissionRoutes(app: FastifyInstance) {
  /**
   * List team permissions for a project.
   */
  app.get<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/permissions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["projects", "permissions"],
      summary: "List project team permissions",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const permissions = await app.prisma.projectTeamPermission.findMany({
      where: { projectId },
      select: {
        id: true,
        permission: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, displayName: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, permissions);
  });

  /**
   * Grant a team permission.
   */
  app.post<{
    Params: { projectId: string };
    Body: { userId: string; permission: string };
  }>("/v1/projects/:projectId/permissions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["projects", "permissions"],
      summary: "Grant a project team permission",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["userId", "permission"],
        properties: {
          userId: { type: "string", format: "uuid" },
          permission: { type: "string", enum: ["DEPLOY", "EDIT", "VIEW"] },
        },
      },
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const { userId, permission } = req.body as { userId: string; permission: string };
    const grantedBy = req.user?.sub;
    if (!grantedBy) throw errors.unauthenticated();

    // Verify project exists
    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");

    // Check requester has access
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    // Check if permission already exists
    const existing = await app.prisma.projectTeamPermission.findUnique({
      where: {
        projectId_userId_permission: { projectId, userId, permission },
      },
    });
    if (existing) throw errors.validation("Permission already granted");

    const perm = await app.prisma.projectTeamPermission.create({
      data: {
        projectId,
        userId,
        permission,
        grantedBy,
      },
      include: {
        user: {
          select: { id: true, email: true, displayName: true },
        },
      },
    });

    await auditFromRequest(app.prisma, req, "PROJECT_UPDATED", "PROJECT", projectId, project.workspaceId, {
      action: "PERMISSION_GRANTED",
      userId,
      permission,
    });

    return ok(reply, perm, 201);
  });

  /**
   * Revoke a team permission.
   */
  app.delete<{
    Params: { projectId: string; permissionId: string };
  }>("/v1/projects/:projectId/permissions/:permissionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["projects", "permissions"],
      summary: "Revoke a project team permission",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const permissionId = (req.params as { permissionId: string }).permissionId;

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");

    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    await app.prisma.projectTeamPermission.delete({
      where: { id: permissionId, projectId },
    });

    await auditFromRequest(app.prisma, req, "PROJECT_UPDATED", "PROJECT", projectId, project.workspaceId, {
      action: "PERMISSION_REVOKED",
      permissionId,
    });

    return ok(reply, { success: true });
  });

  /**
   * Check if user has a specific permission.
   */
  app.get<{
    Params: { projectId: string; userId: string; permission: string };
  }>("/v1/projects/:projectId/permissions/:userId/:permission", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["projects", "permissions"],
      summary: "Check project permission",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const userId = (req.params as { userId: string }).userId;
    const permission = (req.params as { permission: string }).permission;

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const perm = await app.prisma.projectTeamPermission.findUnique({
      where: {
        projectId_userId_permission: { projectId, userId, permission },
      },
    });

    return ok(reply, { hasPermission: !!perm });
  });
}
