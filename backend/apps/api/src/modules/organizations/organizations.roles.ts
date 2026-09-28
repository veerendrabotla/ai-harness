/**
 * Custom Roles and Permissions Routes.
 * Organization-level custom role management.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

const BUILTIN_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

const DEFAULT_PERMISSIONS = {
  OWNER: [
    "organization.manage",
    "organization.billing",
    "workspace.create",
    "workspace.manage",
    "workspace.delete",
    "member.invite",
    "member.remove",
    "member.role.manage",
    "project.create",
    "project.manage",
    "project.delete",
    "task.create",
    "task.manage",
    "task.cancel",
    "deployment.create",
    "deployment.manage",
    "settings.sso.manage",
    "settings.ip.manage",
    "audit.view",
    "audit.export",
    "roles.manage",
    "domains.manage",
  ],
  ADMIN: [
    "workspace.create",
    "workspace.manage",
    "member.invite",
    "member.remove",
    "project.create",
    "project.manage",
    "task.create",
    "task.manage",
    "task.cancel",
    "deployment.create",
    "deployment.manage",
    "audit.view",
  ],
  MEMBER: [
    "project.create",
    "task.create",
    "task.cancel",
    "deployment.create",
  ],
  VIEWER: [
    "project.view",
    "task.view",
    "deployment.view",
  ],
};

export default function registerRolesPermissionsRoutes(app: FastifyInstance) {
  /**
   * List roles for an organization.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/roles", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "permissions"],
      summary: "List organization roles",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) throw errors.forbidden();

    // Built-in roles with their permissions
    const roles = BUILTIN_ROLES.map((name) => ({
      id: name.toLowerCase(),
      name,
      type: "builtin" as const,
      permissions: DEFAULT_PERMISSIONS[name as keyof typeof DEFAULT_PERMISSIONS] ?? [],
    }));

    return ok(reply, roles);
  });

  /**
   * Get permissions for a role.
   */
  app.get<{
    Params: { orgId: string; roleId: string };
  }>("/v1/organizations/:orgId/roles/:roleId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "permissions"],
      summary: "Get role permissions",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const roleId = (req.params as { roleId: string }).roleId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) throw errors.forbidden();

    const roleName = roleId.toUpperCase();
    if (!BUILTIN_ROLES.includes(roleName)) {
      throw errors.notFound("Role");
    }

    return ok(reply, {
      id: roleId,
      name: roleName,
      type: "builtin",
      permissions: DEFAULT_PERMISSIONS[roleName as keyof typeof DEFAULT_PERMISSIONS] ?? [],
    });
  });

  /**
   * List all available permissions.
   */
  app.get("/v1/permissions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "permissions"],
      summary: "List all available permissions",
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    const allPermissions = [
      { id: "organization.manage", category: "organization", description: "Manage organization settings" },
      { id: "organization.billing", category: "organization", description: "Manage billing and subscriptions" },
      { id: "workspace.create", category: "workspace", description: "Create workspaces" },
      { id: "workspace.manage", category: "workspace", description: "Manage workspace settings" },
      { id: "workspace.delete", category: "workspace", description: "Delete workspaces" },
      { id: "member.invite", category: "members", description: "Invite members" },
      { id: "member.remove", category: "members", description: "Remove members" },
      { id: "member.role.manage", category: "members", description: "Manage member roles" },
      { id: "project.create", category: "project", description: "Create projects" },
      { id: "project.manage", category: "project", description: "Manage projects" },
      { id: "project.delete", category: "project", description: "Delete projects" },
      { id: "project.view", category: "project", description: "View projects" },
      { id: "task.create", category: "task", description: "Create tasks" },
      { id: "task.manage", category: "task", description: "Manage tasks" },
      { id: "task.cancel", category: "task", description: "Cancel tasks" },
      { id: "task.view", category: "task", description: "View tasks" },
      { id: "deployment.create", category: "deployment", description: "Create deployments" },
      { id: "deployment.manage", category: "deployment", description: "Manage deployments" },
      { id: "deployment.view", category: "deployment", description: "View deployments" },
      { id: "settings.sso.manage", category: "settings", description: "Manage SSO settings" },
      { id: "settings.ip.manage", category: "settings", description: "Manage IP allowlist" },
      { id: "audit.view", category: "audit", description: "View audit logs" },
      { id: "audit.export", category: "audit", description: "Export audit logs" },
      { id: "roles.manage", category: "roles", description: "Manage custom roles" },
      { id: "domains.manage", category: "domains", description: "Manage verified domains" },
    ];

    return ok(reply, allPermissions);
  });

  /**
   * Check if current user has a specific permission.
   */
  app.post<{
    Params: { orgId: string };
    Body: { permission: string };
  }>("/v1/organizations/:orgId/permissions/check", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "permissions"],
      summary: "Check user permission",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["permission"],
        properties: {
          permission: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const { permission } = req.body as { permission: string };

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });

    if (!membership) {
      return ok(reply, { hasPermission: false });
    }

    const rolePermissions = DEFAULT_PERMISSIONS[membership.role as keyof typeof DEFAULT_PERMISSIONS] ?? [];
    const hasPermission = rolePermissions.includes(permission);

    return ok(reply, { hasPermission, role: membership.role, permission });
  });
}
