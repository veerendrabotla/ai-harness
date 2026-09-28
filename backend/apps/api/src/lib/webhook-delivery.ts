import type { PrismaClient } from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import crypto from "node:crypto";

const RETRY_DELAYS = [5_000, 30_000, 120_000, 600_000];

export function getNextRetryTime(attemptCount: number): Date | null {
  if (attemptCount >= RETRY_DELAYS.length) return null;
  const delay = RETRY_DELAYS[attemptCount];
  return new Date(Date.now() + (delay ?? 60_000));
}

export function computeSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function deliverWebhook(
  url: string,
  payload: Record<string, unknown>,
  secret?: string,
): Promise<{ success: boolean; error?: string }> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": (payload.event as string) ?? "unknown",
    "X-Webhook-Timestamp": new Date().toISOString(),
  };

  if (secret) {
    headers["X-Webhook-Signature"] = `sha256=${computeSignature(body, secret)}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function createAndDeliverWebhookEvent(
  prisma: PrismaClient,
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: {
      workspaceId,
      status: "ACTIVE",
      eventTypes: { has: event },
    },
  });

  for (const sub of subscriptions) {
    await prisma.webhookDeliveryLog.create({
      data: {
        subscriptionId: sub.id,
        event,
        payload: payload as InputJsonValue,
        maxAttempts: sub.maxRetries,
        status: "PENDING",
      },
    });
  }
}

export async function processPendingDeliveries(
  prisma: PrismaClient,
): Promise<{ processed: number; failed: number }> {
  const now = new Date();
  let processed = 0;
  let failed = 0;

  const pending = await prisma.webhookDeliveryLog.findMany({
    where: {
      status: "PENDING",
      OR: [
        { nextRetryAt: null },
        { nextRetryAt: { lte: now } },
      ],
    },
    include: { subscription: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  for (const log of pending) {
    const sub = log.subscription;
    const result = await deliverWebhook(
      sub.url,
      log.payload as Record<string, unknown>,
      sub.secret ?? undefined,
    );

    const newAttemptCount = log.attemptCount + 1;

    if (result.success) {
      await prisma.webhookDeliveryLog.update({
        where: { id: log.id },
        data: {
          status: "DELIVERED",
          attemptCount: newAttemptCount,
          deliveredAt: now,
        },
      });
      processed++;
    } else if (newAttemptCount >= log.maxAttempts) {
      await prisma.webhookDeliveryLog.update({
        where: { id: log.id },
        data: {
          status: "DEAD",
          attemptCount: newAttemptCount,
          lastError: result.error,
        },
      });
      failed++;
    } else {
      const nextRetry = getNextRetryTime(newAttemptCount);
      await prisma.webhookDeliveryLog.update({
        where: { id: log.id },
        data: {
          attemptCount: newAttemptCount,
          lastError: result.error,
          nextRetryAt: nextRetry,
        },
      });
    }
  }

  return { processed, failed };
}
