/**
 * Custom Role CRUD Routes.
 * Create, read, update, delete custom roles for organizations.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

const ALL_PERMISSIONS = [
  "organization.manage", "organization.billing",
  "workspace.create", "workspace.manage", "workspace.delete",
  "member.invite", "member.remove", "member.role.manage",
  "project.create", "project.manage", "project.delete", "project.view",
  "task.create", "task.manage", "task.cancel", "task.view",
  "deployment.create", "deployment.manage", "deployment.view",
  "settings.sso.manage", "settings.ip.manage",
  "audit.view", "audit.export",
  "roles.manage", "webhooks.manage", "knowledge.manage",
  "environments.manage", "integrations.manage",
];

function isSubsetOfAllowed(permissions: string[]): boolean {
  return permissions.every((p) => ALL_PERMISSIONS.includes(p));
}

export default function registerCustomRoleRoutes(app: FastifyInstance) {
  /**
   * List custom roles for an organization.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/custom-roles", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "custom-roles"],
      summary: "List custom roles",
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

    const roles = await app.prisma.$queryRaw`
      SELECT * FROM "custom_roles" WHERE "organizationId" = ${orgId} ORDER BY "createdAt" ASC
    ` as Array<Record<string, unknown>>;

    return ok(reply, roles);
  });

  /**
   * Create a custom role.
   */
  app.post<{
    Params: { orgId: string };
    Body: { name: string; description?: string; permissions: string[]; color?: string };
  }>("/v1/organizations/:orgId/custom-roles", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "custom-roles"],
      summary: "Create a custom role",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name", "permissions"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 100 },
          description: { type: "string", maxLength: 500 },
          permissions: { type: "array", items: { type: "string" }, minItems: 1 },
          color: { type: "string", maxLength: 7 },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const { name, description, permissions, color } = req.body as {
      name: string;
      description?: string;
      permissions: string[];
      color?: string;
    };

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership || membership.role.toString() !== "ADMIN") throw errors.forbidden();

    if (!isSubsetOfAllowed(permissions)) {
      throw new Error("One or more permissions are not allowed");
    }

    // Check for duplicate name within org
    const existing = await app.prisma.$queryRaw`
      SELECT id FROM "custom_roles" WHERE "organizationId" = ${orgId} AND "name" = ${name}
    ` as Array<Record<string, unknown>>;
    if (existing.length > 0) {
      throw new Error("A custom role with this name already exists");
    }

    await app.prisma.$executeRaw`
      INSERT INTO "custom_roles" ("id", "organizationId", "name", "description", "permissions", "color", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${orgId}, ${name}, ${description ?? null}, ${JSON.stringify(permissions)}, ${color ?? null}, NOW(), NOW())
    `;

    await auditFromRequest(app.prisma, req, "CUSTOM_ROLE_CREATED", "ORGANIZATION", "custom-role", orgId, {
      orgId,
      roleName: name,
    });

    return ok(reply, { success: true }, 201);
  });

  /**
   * Update a custom role.
   */
  app.put<{
    Params: { orgId: string; roleId: string };
    Body: { name?: string; description?: string; permissions?: string[]; color?: string };
  }>("/v1/organizations/:orgId/custom-roles/:roleId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "custom-roles"],
      summary: "Update a custom role",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const orgId = (req.params as { orgId: string }).orgId;
    const roleId = (req.params as { roleId: string }).roleId;
    const { name, description, permissions, color } = req.body as {
      name?: string;
      description?: string;
      permissions?: string[];
      color?: string;
    };

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership || membership.role.toString() !== "ADMIN") throw errors.forbidden();

    if (permissions && !isSubsetOfAllowed(permissions)) {
      throw new Error("One or more permissions are not allowed");
    }

    const existing = await app.prisma.$queryRaw`
      SELECT id FROM "custom_roles" WHERE "id" = ${roleId} AND "organizationId" = ${orgId}
    ` as Array<Record<string, unknown>>;
    if (existing.length === 0) throw errors.notFound("Custom role");

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`"name" = $${idx}`); values.push(name); idx++; }
    if (description !== undefined) { updates.push(`"description" = $${idx}`); values.push(description); idx++; }
    if (permissions !== undefined) { updates.push(`"permissions" = $${idx}`); values.push(JSON.stringify(permissions)); idx++; }
    if (color !== undefined) { updates.push(`"color" = $${idx}`); values.push(color); idx++; }
    updates.push(`"updatedAt" = NOW()`);

    if (updates.length > 1) {
      values.push(roleId, orgId);
      await app.prisma.$executeRawUnsafe(
        `UPDATE "custom_roles" SET ${updates.join(", ")} WHERE "id" = $${idx} AND "organizationId" = $${idx + 1}`,
        ...values,
      );
    }

    return ok(reply, { success: true });
  });

  /**
   * Delete a custom role.
   */
  app.delete<{
    Params: { orgId: string; roleId: string };
  }>("/v1/organizations/:orgId/custom-roles/:roleId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["roles", "custom-roles"],
      summary: "Delete a custom role",
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
    if (!membership || membership.role.toString() !== "ADMIN") throw errors.forbidden();

    const deleted = await app.prisma.$executeRaw`
      DELETE FROM "custom_roles" WHERE "id" = ${roleId} AND "organizationId" = ${orgId}
    `;
    if (deleted === 0) throw errors.notFound("Custom role");

    await auditFromRequest(app.prisma, req, "CUSTOM_ROLE_DELETED", "ORGANIZATION", roleId, orgId, { orgId });

    return ok(reply, { success: true });
  });
}
