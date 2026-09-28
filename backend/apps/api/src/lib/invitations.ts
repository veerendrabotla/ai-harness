/**
 * Invitation Service.
 * Handles workspace invitation creation and acceptance.
 */
import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { errors } from "@ai-harness/shared";

import { getEnv } from "@ai-harness/shared";
import { sendEmailQueued } from "./notifications.js";
import { invitationEmail } from "./email-templates.js";

export interface InvitationResult {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  inviteUrl: string;
}

function frontendBaseUrl(): string {
  const env = getEnv();
  const raw = env.FRONTEND_URL ?? env.FRONTEND_ORIGIN;
  return (raw ?? "http://localhost:3000").split(",")[0]!.trim();
}

/** Frontend page that accepts an invite token (see settings/invites/accept). */
export function inviteAcceptUrl(token: string): string {
  return `${frontendBaseUrl()}/settings/invites/accept?token=${encodeURIComponent(token)}`;
}

/**
 * Queue the invitation email for the invitee. Delivery failures never fail
 * invitation creation (the raw token is also returned to the inviter).
 */
export async function sendInvitationEmail(
  prisma: PrismaClient,
  input: { email: string; role: string; token: string; workspaceId: string; invitedBy: string },
): Promise<void> {
  try {
    const [workspace, inviter] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: input.invitedBy }, select: { displayName: true, email: true } }),
    ]);
    const inviterName = inviter?.displayName || inviter?.email || "A teammate";
    const template = invitationEmail(
      inviterName,
      workspace?.name ?? "the workspace",
      inviteAcceptUrl(input.token),
      input.role,
    );
    await sendEmailQueued(
      prisma,
      input.email,
      template.subject,
      template.html,
      template.text,
      template.unsubscribeType,
      input.workspaceId,
      { kind: "invitation", role: input.role },
    );
  } catch {
    // Best-effort: the invite record exists regardless of email delivery.
  }
}

/**
 * Create a workspace invitation.
 */
export async function createInvitation(
  prisma: PrismaClient,
  workspaceId: string,
  email: string,
  role: "MEMBER" | "VIEWER",
  invitedBy: string,
): Promise<InvitationResult> {
  // Check if user is already a member
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMember = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
    });
    if (existingMember) {
      throw errors.validation("User is already a member of this workspace");
    }
  }

  // Check for pending invitation
  const existingInvite = await prisma.workspaceInvite.findFirst({
    where: { workspaceId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  if (existingInvite) {
    throw errors.validation("A pending invitation already exists for this email");
  }

  // Generate invitation token
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // Create invitation (expires in 7 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId,
      email,
      role,
      tokenHash,
      invitedBy,
      expiresAt,
    },
  });

  await sendInvitationEmail(prisma, { email, role, token, workspaceId, invitedBy });

  return {
    id: invite.id,
    email,
    role,
    expiresAt,
    inviteUrl: inviteAcceptUrl(token),
  };
}

/**
 * Accept a workspace invitation.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  token: string,
  userId: string,
): Promise<{ workspaceId: string; role: string }> {
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const invite = await prisma.workspaceInvite.findFirst({
    where: { tokenHash, acceptedAt: null },
    include: { workspace: { select: { id: true, name: true } } },
  });

  if (!invite) {
    throw errors.notFound("Invitation");
  }

  if (invite.expiresAt < new Date()) {
    throw errors.validation("Invitation has expired");
  }

  // Check if user email matches invitation
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.email !== invite.email) {
    throw errors.forbidden("This invitation is for a different email address");
  }

  // Add user to workspace
  await prisma.workspaceMember.create({
    data: {
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role as "MEMBER" | "VIEWER",
    },
  });

  // Mark invitation as accepted
  await prisma.workspaceInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });

  return {
    workspaceId: invite.workspaceId,
    role: invite.role,
  };
}

/**
 * Revoke a workspace invitation.
 */
export async function revokeInvitation(
  prisma: PrismaClient,
  inviteId: string,
): Promise<void> {
  await prisma.workspaceInvite.delete({ where: { id: inviteId } });
}
