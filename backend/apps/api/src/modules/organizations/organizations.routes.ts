/**
 * Organization API Routes.
 * Team hierarchy management.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

export default function registerOrganizationRoutes(app: FastifyInstance) {
  /**
   * List organizations for current user.
   */
  app.get("/v1/organizations", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations"],
      summary: "List organizations for current user",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const memberships = await app.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            status: true,
            createdAt: true,
            _count: { select: { members: true, workspaces: true } },
          },
        },
      },
    });

    return ok(reply, memberships.map((m) => ({
      ...m.organization,
      role: m.role,
    })));
  });

  /**
   * Create a new organization.
   */
  app.post("/v1/organizations", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations"],
      summary: "Create a new organization",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name", "slug"],
        properties: {
          name: { type: "string", maxLength: 200 },
          slug: { type: "string", maxLength: 100, pattern: "^[a-z0-9-]+$" },
          description: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const { name, slug, description } = req.body as { name: string; slug: string; description?: string };

    // Check slug uniqueness
    const existing = await app.prisma.organization.findUnique({ where: { slug } });
    if (existing) throw errors.validation("Organization slug already taken");

    const organization = await app.prisma.organization.create({
      data: {
        name,
        slug,
        description,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: "OWNER",
          },
        },
      },
    });

    return ok(reply, organization, 201);
  });

  /**
   * Get organization details.
   */
  app.get<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations"],
      summary: "Get organization details",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const orgId = (req.params as { orgId: string }).orgId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            status: true,
            ownerId: true,
            createdAt: true,
            members: {
              select: {
                role: true,
                user: {
                  select: { id: true, email: true, displayName: true, avatarUrl: true },
                },
              },
            },
            workspaces: {
              select: {
                id: true,
                name: true,
                status: true,
                _count: { select: { members: true, projects: true } },
              },
            },
          },
        },
      },
    });

    if (!membership) throw errors.forbidden();

    return ok(reply, membership.organization);
  });

  /**
   * Update organization.
   */
  app.patch<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations"],
      summary: "Update organization details",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 200 },
          description: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const orgId = (req.params as { orgId: string }).orgId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });

    if (!membership || membership.role !== "OWNER") {
      throw errors.forbidden();
    }

    const { name, description } = req.body as { name?: string; description?: string };

    const updated = await app.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
      },
    });

    return ok(reply, updated);
  });

  /**
   * Add member to organization.
   */
  app.post<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/members", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations"],
      summary: "Add member to organization",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["email", "role"],
        properties: {
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["OWNER", "MEMBER", "VIEWER"] },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const orgId = (req.params as { orgId: string }).orgId;
    const { email, role } = req.body as { email: string; role: string };

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });

    if (!membership || membership.role !== "OWNER") {
      throw errors.forbidden();
    }

    const userToAdd = await app.prisma.user.findUnique({ where: { email } });
    if (!userToAdd) throw errors.notFound("User");

    const existingMember = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: userToAdd.id } },
    });
    if (existingMember) throw errors.validation("User already a member");

    const newMember = await app.prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: userToAdd.id,
        role: role as "OWNER" | "MEMBER" | "VIEWER",
      },
    });

    return ok(reply, newMember, 201);
  });

  /**
   * Remove member from organization.
   */
  app.delete<{
    Params: { orgId: string; memberId: string };
  }>("/v1/organizations/:orgId/members/:memberId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations"],
      summary: "Remove member from organization",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const orgId = (req.params as { orgId: string }).orgId;
    const memberId = (req.params as { memberId: string }).memberId;

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });

    if (!membership || membership.role !== "OWNER") {
      throw errors.forbidden();
    }

    // Cannot remove yourself
    if (memberId === userId) {
      throw errors.validation("Cannot remove yourself from the organization");
    }

    await app.prisma.organizationMember.delete({
      where: { id: memberId },
    });

    return ok(reply, { success: true });
  });

  /**
   * Link workspace to organization.
   */
  app.post<{
    Params: { orgId: string };
  }>("/v1/organizations/:orgId/workspaces", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["organizations"],
      summary: "Link workspace to organization",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const orgId = (req.params as { orgId: string }).orgId;
    const { workspaceId } = req.body as { workspaceId: string };

    const membership = await app.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });

    if (!membership || membership.role !== "OWNER") {
      throw errors.forbidden();
    }

    // Check workspace exists
    const workspace = await app.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw errors.notFound("Workspace");

    const updated = await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: { organizationId: orgId },
    });

    return ok(reply, updated);
  });
}
