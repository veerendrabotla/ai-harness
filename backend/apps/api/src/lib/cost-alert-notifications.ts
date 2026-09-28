/**
 * Cost Alert Notification Service.
 * Sends email/webhook notifications when cost thresholds are exceeded.
 */
import type { PrismaClient } from "@prisma/client";
import { getEnv } from "@ai-harness/shared";
import pino from "pino";

const log = pino({ name: "cost-alert-notifications", level: "warn" });

interface CostAlertNotification {
  workspaceId: string;
  alertId: string;
  thresholdType: string;
  thresholdValue: number;
  period: string;
  currentValue: number;
}

/**
 * Send cost alert notifications when thresholds fire.
 */
export async function sendCostAlertNotifications(
  prisma: PrismaClient,
  alert: CostAlertNotification,
): Promise<void> {
  const env = getEnv();

  // Get workspace info
  const workspace = await prisma.workspace.findUnique({
    where: { id: alert.workspaceId },
    select: { name: true, webhookUrls: true },
  });
  if (!workspace) return;

  // Get workspace owner for email notification
  const owner = await prisma.user.findUnique({
    where: { id: (await prisma.workspace.findUnique({ where: { id: alert.workspaceId } }))?.ownerId ?? "" },
    select: { email: true, displayName: true },
  });

  const subject = `Cost alert: ${workspace.name} exceeded ${alert.thresholdType.toLowerCase()} threshold`;
  const message = `Workspace "${workspace.name}" has exceeded its ${alert.thresholdType.toLowerCase()} threshold.\n\n` +
    `Threshold: ${alert.thresholdType === "COST" ? `$${alert.thresholdValue}` : alert.thresholdValue.toLocaleString()} ${alert.thresholdType.toLowerCase()}\n` +
    `Current: ${alert.thresholdType === "COST" ? `$${alert.currentValue.toFixed(2)}` : alert.currentValue.toLocaleString()} ${alert.thresholdType.toLowerCase()}\n` +
    `Period: ${alert.period}\n\n` +
    `Please review your usage at ${env.FRONTEND_ORIGIN}/settings/billing`;

  // Send email notification
  if (owner?.email && env.RESEND_API_KEY && env.RESEND_FROM) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: env.RESEND_FROM,
        to: owner.email,
        subject,
        text: message,
      });
    } catch (err) {
      log.error({ err }, "[Webhook] Email sending failed:");
    }
  }

  // Send webhook notifications
  if (workspace.webhookUrls && workspace.webhookUrls.length > 0) {
    const payload = JSON.stringify({
      type: "cost_alert",
      workspace: { id: alert.workspaceId, name: workspace.name },
      alert: {
        id: alert.alertId,
        thresholdType: alert.thresholdType,
        thresholdValue: alert.thresholdValue,
        currentValue: alert.currentValue,
        period: alert.period,
      },
      message,
      timestamp: new Date().toISOString(),
    });

    for (const url of workspace.webhookUrls) {
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        log.error({ err, url }, "[Webhook] Webhook delivery failure:");
      }
    }
  }
}
