import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  acceptInviteRequestSchema,
  createInviteRequestSchema,
} from "@ai-harness/contracts";
import { generateOpaqueToken, sha256Hex, errors } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";
import { sendInvitationEmail } from "../../lib/invitations.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Workspace invitations (PRD F-02 scope): owner invites an email with a role;
 * the recipient accepts via single-use token, creating their membership.
 */
export default function registerInviteRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  app.get("/v1/workspaces/:workspaceId/invites", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["invites"],
      summary: "List pending invites for a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const invites = await app.prisma.workspaceInvite.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      reply,
      invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    );
  });

  app.post("/v1/workspaces/:workspaceId/invites", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["invites"],
      summary: "Create a workspace invite",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const input = createInviteRequestSchema.parse(req.body);

    if ((await app.prisma.workspace.findUnique({ where: { id: workspaceId } }))?.status === "ARCHIVED") {
      throw errors.workspaceArchived();
    }
    const existingUser = await app.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existingUser) {
      const member = await app.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      });
      if (member) throw errors.conflict("User is already a member of this workspace");
    }

    const raw = generateOpaqueToken(32);
    const invite = await app.prisma.workspaceInvite.create({
      data: {
        id: randomUUID(),
        workspaceId,
        email: input.email.toLowerCase(),
        role: input.role,
        tokenHash: sha256Hex(raw),
        invitedBy: req.user!.sub,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "INVITE_CREATED",
      entityType: "WORKSPACE_INVITE",
      entityId: invite.id,
      metadata: { role: input.role },
    });

    // Queue the invitation email (best-effort; token is also returned below).
    await sendInvitationEmail(app.prisma, {
      email: invite.email,
      role: invite.role,
      token: raw,
      workspaceId,
      invitedBy: req.user!.sub,
    });

    // Token is returned once to the owner so they can also deliver it out-of-band.
    return ok(reply, { id: invite.id, token: raw, expiresAt: invite.expiresAt.toISOString() }, 201);
  });

  app.delete("/v1/workspaces/:workspaceId/invites/:inviteId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["invites"],
      summary: "Cancel a workspace invite",
      params: {
        type: "object",
        required: ["workspaceId", "inviteId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          inviteId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    const inviteId = reqParam(req, "inviteId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const deleted = await app.prisma.workspaceInvite.deleteMany({
      where: { id: inviteId, workspaceId, acceptedAt: null },
    });
    if (deleted.count === 0) throw errors.notFound("Invite");
    return ok(reply, { success: true });
  });

  /** Authenticated user redeems an invite token → becomes member. */
  app.post("/v1/invites/accept", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["invites"],
      summary: "Accept a workspace invite",
      body: {
        type: "object",
        required: ["token"],
        properties: {
          token: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const input = acceptInviteRequestSchema.parse(req.body);
    const record = await app.prisma.$transaction(async (tx) => {
      const invite = await tx.workspaceInvite.findFirst({
        where: { tokenHash: sha256Hex(input.token), acceptedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!invite) return null;
      const claimed = await tx.workspaceInvite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      return claimed.count === 1 ? invite : null;
    });
    if (!record) throw errors.validation("Invite is invalid, already used, or expired");

    const existing = await app.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: record.workspaceId, userId: req.user!.sub } },
    });
    if (!existing) {
      await app.prisma.workspaceMember.create({
        data: { id: randomUUID(), workspaceId: record.workspaceId, userId: req.user!.sub, role: record.role },
      });
    }
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: record.workspaceId,
      action: "INVITE_ACCEPTED",
      entityType: "WORKSPACE_INVITE",
      entityId: record.id,
      metadata: { role: record.role },
    });
    return ok(reply, { workspaceId: record.workspaceId, role: record.role });
  });
}
