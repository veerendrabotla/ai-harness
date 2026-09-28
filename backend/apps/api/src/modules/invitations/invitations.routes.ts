/**
 * Invitation API Routes.
 * Handle workspace invitation creation and acceptance.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { createInvitation, acceptInvitation, revokeInvitation } from "../../lib/invitations.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerInvitationRoutes(app: FastifyInstance) {
  /**
   * Send workspace invitation.
   */
  app.post<{
    Params: { workspaceId: string };
    Body: { email: string; role: string };
  }>("/v1/workspaces/:workspaceId/invitations", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["invitations"],
      summary: "Send workspace invitation",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["email", "role"],
        properties: {
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["MEMBER", "VIEWER"] },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { email, role } = req.body as { email: string; role: string };
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const invite = await createInvitation(app.prisma, workspaceId, email, role as "MEMBER" | "VIEWER", userId);

    await auditFromRequest(app.prisma, req, "WORKSPACE_MEMBER_ADDED", "WORKSPACE", workspaceId, workspaceId, {
      invitedEmail: email,
      role,
    });

    return ok(reply, invite, 201);
  });

  /**
   * List pending invitations for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/invitations", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["invitations"],
      summary: "List pending invitations",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const invitations = await app.prisma.workspaceInvite.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, invitations);
  });

  /**
   * Revoke a pending invitation.
   */
  app.delete<{
    Params: { workspaceId: string; inviteId: string };
  }>("/v1/workspaces/:workspaceId/invitations/:inviteId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["invitations"],
      summary: "Revoke an invitation",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const inviteId = (req.params as { inviteId: string }).inviteId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    await revokeInvitation(app.prisma, inviteId);

    return ok(reply, { success: true });
  });

  /**
   * Accept invitation (public endpoint).
   */
  app.post<{
    Body: { token: string };
  }>("/v1/invitations/accept", {
    schema: {
      tags: ["invitations"],
      summary: "Accept a workspace invitation",
      body: {
        type: "object",
        required: ["token"],
        properties: {
          token: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const { token } = req.body as { token: string };
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const result = await acceptInvitation(app.prisma, token, userId);

    return ok(reply, result);
  });
}
