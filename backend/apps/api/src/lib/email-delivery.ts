/**
 * Email Delivery Tracking.
 * Create and update email delivery records for analytics.
 */
import type { PrismaClient } from "@prisma/client";

export interface CreateDeliveryParams {
  recipientEmail: string;
  templateType: string;
  subject: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create an email delivery record (QUEUED status).
 */
export async function trackEmailDelivery(
  prisma: PrismaClient,
  params: CreateDeliveryParams,
): Promise<string> {
  const delivery = await prisma.emailDelivery.create({
    data: {
      recipientEmail: params.recipientEmail,
      templateType: params.templateType,
      subject: params.subject,
      workspaceId: params.workspaceId ?? null,
      metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) as never : undefined,
      status: "QUEUED",
    },
  });
  return delivery.id;
}

/**
 * Update delivery status from email provider webhooks.
 */
export async function updateDeliveryStatus(
  prisma: PrismaClient,
  emailId: string,
  status: "SENT" | "DELIVERED" | "OPENED" | "BOUNCED" | "COMPLAINT",
  externalId?: string,
  errorMessage?: string,
): Promise<void> {
  const update: Record<string, unknown> = { status };

  if (externalId) update.externalId = externalId;
  if (errorMessage) update.errorMessage = errorMessage;

  switch (status) {
    case "SENT":
      update.sentAt = new Date();
      break;
    case "DELIVERED":
      update.deliveredAt = new Date();
      break;
    case "OPENED":
      update.openedAt = new Date();
      break;
    case "BOUNCED":
      update.bouncedAt = new Date();
      break;
    case "COMPLAINT":
      update.complaintAt = new Date();
      break;
  }

  await prisma.emailDelivery.update({
    where: { id: emailId },
    data: update,
  });
}

export interface DeliveryStats {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  bounced: number;
  complaint: number;
}

/**
 * Get delivery statistics for a workspace.
 */
export async function getDeliveryStats(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<DeliveryStats> {
  const [total, queued, sent, delivered, opened, bounced, complaint] = await Promise.all([
    prisma.emailDelivery.count({ where: { workspaceId } }),
    prisma.emailDelivery.count({ where: { workspaceId, status: "QUEUED" } }),
    prisma.emailDelivery.count({ where: { workspaceId, status: "SENT" } }),
    prisma.emailDelivery.count({ where: { workspaceId, status: "DELIVERED" } }),
    prisma.emailDelivery.count({ where: { workspaceId, status: "OPENED" } }),
    prisma.emailDelivery.count({ where: { workspaceId, status: "BOUNCED" } }),
    prisma.emailDelivery.count({ where: { workspaceId, status: "COMPLAINT" } }),
  ]);

  return { total, queued, sent, delivered, opened, bounced, complaint };
}
