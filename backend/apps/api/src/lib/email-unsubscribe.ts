/**
 * Email Unsubscribe Management.
 * Handle unsubscribe requests and check subscription status.
 */
import type { PrismaClient } from "@prisma/client";

export const UNSUBSCRIBE_TYPES = [
  "all",
  "task_completed",
  "task_failed",
  "deployment_ready",
  "deployment_failed",
  "code_review",
  "comment",
  "mention",
  "approval_request",
  "usage_warning",
  "invitation",
  "marketing",
] as const;

export type UnsubscribeType = (typeof UNSUBSCRIBE_TYPES)[number];

/**
 * Create an unsubscribe record.
 */
export async function createUnsubscribe(
  prisma: PrismaClient,
  email: string,
  unsubscribeType: UnsubscribeType,
  workspaceId?: string,
): Promise<void> {
  await prisma.emailUnsubscribe.upsert({
    where: {
      email_unsubscribeType: { email, unsubscribeType },
    },
    update: {},
    create: {
      email,
      unsubscribeType,
      workspaceId: workspaceId ?? null,
    },
  });
}

/**
 * Check if an email is unsubscribed from a specific notification type.
 * Also checks "all" type which unsubscribes from everything.
 */
export async function isUnsubscribed(
  prisma: PrismaClient,
  email: string,
  unsubscribeType: UnsubscribeType,
): Promise<boolean> {
  const record = await prisma.emailUnsubscribe.findFirst({
    where: {
      email,
      OR: [
        { unsubscribeType },
        { unsubscribeType: "all" },
      ],
    },
  });
  return record !== null;
}

/**
 * Remove an unsubscribe record (re-subscribe).
 */
export async function removeUnsubscribe(
  prisma: PrismaClient,
  email: string,
  unsubscribeType: UnsubscribeType,
): Promise<void> {
  await prisma.emailUnsubscribe.deleteMany({
    where: {
      email,
      unsubscribeType,
    },
  });
}

/**
 * Get all unsubscribe records for an email.
 */
export async function getUnsubscribes(
  prisma: PrismaClient,
  email: string,
): Promise<Array<{ unsubscribeType: string; workspaceId: string | null; createdAt: Date }>> {
  return prisma.emailUnsubscribe.findMany({
    where: { email },
    select: {
      unsubscribeType: true,
      workspaceId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Generate an unsubscribe URL for a given email and type.
 */
export function generateUnsubscribeUrl(
  email: string,
  type: UnsubscribeType,
  baseUrl: string,
): string {
  const encoded = encodeURIComponent(email);
  return `${baseUrl}/unsubscribe?email=${encoded}&type=${type}`;
}
