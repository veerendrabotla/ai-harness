import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  createWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  addMemberRequestSchema,
  updateMemberRequestSchema,
} from "@ai-harness/contracts";
import { errors } from "@ai-harness/shared";
import { createWorkspaceRepository, createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";
import { withCache, cacheInvalidate } from "../../lib/cache.js";

export default function registerWorkspaceRoutes(app: FastifyInstance) {
  const workspaces = createWorkspaceRepository(app.prisma);
  const audit = createAuditRepository(app.prisma);

  app.get("/v1/workspaces", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "List workspaces for the authenticated user",
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const rows = await withCache(`workspaces:user:${userId}`, 30, () => workspaces.listForUser(userId));
    return ok(reply, rows.map((w) => toWorkspaceDto(w)));
  });

  app.post("/v1/workspaces", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Create a new workspace",
      body: {
        type: "object",
        // executionMode is optional — createWorkspaceRequestSchema defaults it
        // to "CLOUD" (keep this schema in sync with the zod contract).
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          description: { type: "string", maxLength: 2000 },
          executionMode: { type: "string", enum: ["CLOUD", "LOCAL_CONNECTED", "HYBRID"] },
          initialInstructions: { type: "string", maxLength: 10000 },
        },
      },
    },
  }, async (req, reply) => {
    const input = createWorkspaceRequestSchema.parse(req.body);
    const created = await workspaces.createWithDefaults({
      ownerId: req.user!.sub,
      name: input.name,
      description: input.description ?? null,
      executionMode: input.executionMode,
      initialInstructions: input.initialInstructions ?? null,
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: created.id,
      action: "WORKSPACE_CREATED",
      entityType: "WORKSPACE",
      entityId: created.id,
    });
    await cacheInvalidate(`workspaces:user:${req.user!.sub}`);
    return ok(reply, toWorkspaceDto(created, { role: "OWNER" }), 201);
  });

  app.get("/v1/workspaces/:workspaceId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Get workspace details with policy and counts",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    const ctx = await app.requireWorkspaceRole(req, workspaceId, "VIEWER");
    const ws = await withCache(`workspace:${workspaceId}`, 30, () =>
      app.prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { policy: true },
      }),
    );
    if (!ws) throw errors.notFound("Workspace");
    const memberCount = await app.prisma.workspaceMember.count({ where: { workspaceId } });
    const projectCount = await app.prisma.project.count({ where: { workspaceId } });
    return ok(reply, { ...toWorkspaceDto(ws), policy: ws.policy ? serializePolicy(ws.policy) : null, memberCount, projectCount, viewerRole: ctx.role });
  });

  app.patch("/v1/workspaces/:workspaceId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Update workspace name or execution mode",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    if ((await app.prisma.workspace.findUnique({ where: { id: workspaceId } }))?.status === "ARCHIVED") {
      // Renaming an archived workspace is allowed; execution mode changes are not.
      const body = updateWorkspaceRequestSchema.parse(req.body);
      if (body.executionMode && body.executionMode !== "CLOUD") {
        throw errors.workspaceArchived();
      }
    }
    const input = updateWorkspaceRequestSchema.parse(req.body);
    const updated = await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.executionMode !== undefined ? { executionMode: input.executionMode } : {}),
      },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "WORKSPACE_UPDATED",
      entityType: "WORKSPACE",
      entityId: workspaceId,
      metadata: { fields: Object.keys(input) },
    });
    await cacheInvalidate(`workspace:${workspaceId}`);
    await cacheInvalidate(`workspaces:user:${req.user!.sub}`);
    return ok(reply, toWorkspaceDto(updated));
  });

  app.post("/v1/workspaces/:workspaceId/archive", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Archive a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const updated = await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "ARCHIVED" },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "WORKSPACE_ARCHIVED",
      entityType: "WORKSPACE",
      entityId: workspaceId,
    });
    await cacheInvalidate(`workspace:${workspaceId}`);
    await cacheInvalidate(`workspaces:user:${req.user!.sub}`);
    return ok(reply, toWorkspaceDto(updated));
  });

  app.post("/v1/workspaces/:workspaceId/unarchive", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Unarchive a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const updated = await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "ACTIVE" },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "WORKSPACE_UNARCHIVED",
      entityType: "WORKSPACE",
      entityId: workspaceId,
    });
    await cacheInvalidate(`workspace:${workspaceId}`);
    await cacheInvalidate(`workspaces:user:${req.user!.sub}`);
    return ok(reply, toWorkspaceDto(updated));
  });

  // ── Members ───────────────────────────────────────────────

  app.get("/v1/workspaces/:workspaceId/members", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "List workspace members",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");
    const members = await app.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok(
      reply,
      members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        email: m.user.email,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
      })),
    );
  });

  app.post("/v1/workspaces/:workspaceId/members", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Add a member to the workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const input = addMemberRequestSchema.parse(req.body);
    const targetUser = await app.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!targetUser || targetUser.status !== "ACTIVE") throw errors.notFound("User with that email");
    const existing = await app.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUser.id } },
    });
    if (existing) throw errors.conflict("User is already a member of this workspace");
    const member = await app.prisma.workspaceMember.create({
      data: { id: randomUUID(), workspaceId, userId: targetUser.id, role: input.role },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "MEMBER_ADDED",
      entityType: "WORKSPACE_MEMBER",
      entityId: member.id,
      metadata: { role: input.role },
    });
    return ok(reply, { id: member.id, userId: targetUser.id, role: member.role }, 201);
  });

  app.patch("/v1/workspaces/:workspaceId/members/:memberId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Update a workspace member's role",
      params: {
        type: "object",
        required: ["workspaceId", "memberId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          memberId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    const memberId = reqParam(req, "memberId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const input = updateMemberRequestSchema.parse(req.body);
    const existing = await app.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!existing) throw errors.notFound("Member");
    if (existing.role === "OWNER") {
      throw errors.conflict("Transfer ownership explicitly before changing the owner role");
    }
    if (input.role === "OWNER") {
      throw errors.conflict("Ownership transfer is not part of this phase");
    }
    const updated = await app.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: input.role },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "MEMBER_ROLE_UPDATED",
      entityType: "WORKSPACE_MEMBER",
      entityId: memberId,
      metadata: { role: input.role },
    });
    return ok(reply, { id: updated.id, role: updated.role });
  });

  app.delete("/v1/workspaces/:workspaceId/members/:memberId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspaces"],
      summary: "Remove a member from the workspace",
      params: {
        type: "object",
        required: ["workspaceId", "memberId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          memberId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    const memberId = reqParam(req, "memberId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const existing = await app.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!existing) throw errors.notFound("Member");
    if (existing.role === "OWNER") throw errors.conflict("The owner cannot be removed");
    await app.prisma.workspaceMember.delete({ where: { id: memberId } });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "MEMBER_REMOVED",
      entityType: "WORKSPACE_MEMBER",
      entityId: memberId,
    });
    return ok(reply, { success: true });
  });
}



function toWorkspaceDto(
  ws: {
    id: string;
    ownerId: string;
    name: string;
    description: string | null;
    executionMode: string;
    status: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  },
  extra?: { role?: "OWNER" | "MEMBER" | "VIEWER" },
) {
  return {
    id: ws.id,
    ownerId: ws.ownerId,
    name: ws.name,
    description: ws.description,
    executionMode: ws.executionMode,
    status: ws.status,
    createdAt: ws.createdAt instanceof Date ? ws.createdAt.toISOString() : ws.createdAt,
    updatedAt: ws.updatedAt instanceof Date ? ws.updatedAt.toISOString() : ws.updatedAt,
    ...(extra?.role ? { viewerRole: extra.role } : {}),
  };
}

function serializePolicy(policy: {
  id: string;
  requirePlanApproval: boolean;
  allowDirectExecution: boolean;
  maxTaskDurationSeconds: number;
  maxToolCallsPerRun: number;
  maxSubagents: number;
  blockOnReviewFindings?: boolean;
}) {
  return {
    id: policy.id,
    requirePlanApproval: policy.requirePlanApproval,
    allowDirectExecution: policy.allowDirectExecution,
    maxTaskDurationSeconds: policy.maxTaskDurationSeconds,
    maxToolCallsPerRun: policy.maxToolCallsPerRun,
    maxSubagents: policy.maxSubagents,
    blockOnReviewFindings: policy.blockOnReviewFindings ?? false,
  };
}
