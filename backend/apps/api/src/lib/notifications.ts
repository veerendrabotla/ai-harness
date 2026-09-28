/**
 * Notification Service.
 * Email and webhook notification delivery via BullMQ queue.
 */
import type { PrismaClient } from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { getEnv } from "@ai-harness/shared";
import pino from "pino";
import { enqueueEmail } from "./email-queue.js";
import { trackEmailDelivery } from "./email-delivery.js";
import { isUnsubscribed, generateUnsubscribeUrl, type UnsubscribeType } from "./email-unsubscribe.js";
import {
  taskCompletionEmail,
  deploymentReadyEmail,
  deploymentFailedEmail,
  approvalRequestEmail,
  usageWarningEmail,
} from "./email-templates.js";

const log = pino({ name: "notifications", level: "warn" });

export interface NotificationPayload {
  type: "task_completed" | "task_failed" | "deployment_ready" | "deployment_failed" | "approval_needed" | "usage_warning";
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const EVENT_TYPE_MAP: Record<string, string> = {
  task_completed: "task.completed",
  task_failed: "task.failed",
  deployment_ready: "deployment.ready",
  deployment_failed: "deployment.failed",
  approval_needed: "approval.requested",
  usage_warning: "workspace.updated",
};

/**
 * Send email via queue (async, non-blocking).
 */
export async function sendEmailQueued(
  prisma: PrismaClient,
  to: string,
  subject: string,
  html: string,
  text: string,
  templateType: string,
  workspaceId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const emailId = await trackEmailDelivery(prisma, {
    recipientEmail: to,
    templateType,
    subject,
    workspaceId,
    metadata,
  });

  await enqueueEmail({
    emailId,
    recipientEmail: to,
    subject,
    html,
    text,
    templateType,
    workspaceId,
    metadata,
  });
}

export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.error({ url, status: response.status }, "Webhook failed:");
    }
  } catch (error) {
    log.error({ err: error, url }, "Webhook error:");
  }
}

async function createInAppNotification(
  prisma: PrismaClient,
  userId: string,
  notification: NotificationPayload,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        metadata: (notification.metadata as InputJsonValue) ?? undefined,
      },
    });
  } catch (err) {
    log.error({ err, userId }, "[Notification] Failed to create in-app notification:");
  }
}

function getBaseUrl(): string {
  const env = getEnv();
  return env.FRONTEND_URL ?? env.FRONTEND_ORIGIN;
}

export async function notifyWorkspace(
  prisma: PrismaClient,
  workspaceId: string,
  notification: NotificationPayload,
  templateType?: UnsubscribeType,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      members: {
        select: {
          userId: true,
          user: {
            select: {
              email: true,
              displayName: true,
              notificationPreferences: true,
            },
          },
        },
      },
    },
  });

  if (!workspace) return;

  const webhookEvent = EVENT_TYPE_MAP[notification.type] ?? notification.type;
  const { createAndDeliverWebhookEvent } = await import("./webhook-delivery.js");

  await createAndDeliverWebhookEvent(prisma, workspaceId, webhookEvent, {
    workspaceId,
    ...notification,
    ...notification.metadata,
  });

  const baseUrl = getBaseUrl();
  const unsubType = templateType ?? (notification.type as UnsubscribeType);

  for (const member of workspace.members) {
    const prefs = member.user.notificationPreferences as Record<string, boolean> | null;

    if (prefs?.inApp !== false) {
      await createInAppNotification(prisma, member.userId, notification);
    }

    if (prefs?.email === false) continue;

    const unsubscribed = await isUnsubscribed(prisma, member.user.email, unsubType);
    if (unsubscribed) continue;

    const unsubscribeUrl = generateUnsubscribeUrl(member.user.email, unsubType, baseUrl);

    let template;
    switch (notification.type) {
      case "task_completed":
        template = taskCompletionEmail(
          notification.message,
          (notification.metadata?.taskId as string) ?? "",
          "completed",
          undefined,
          unsubscribeUrl,
          baseUrl,
        );
        break;
      case "task_failed":
        template = taskCompletionEmail(
          notification.message,
          (notification.metadata?.taskId as string) ?? "",
          "failed",
          notification.metadata?.error as string,
          unsubscribeUrl,
          baseUrl,
        );
        break;
      case "deployment_ready":
        template = deploymentReadyEmail(
          (notification.metadata?.projectName as string) ?? "Project",
          (notification.metadata?.deploymentId as string) ?? "",
          (notification.metadata?.environment as string) ?? "production",
          (notification.metadata?.url as string) ?? "",
          (notification.metadata?.branch as string) ?? "main",
          unsubscribeUrl,
        );
        break;
      case "deployment_failed":
        template = deploymentFailedEmail(
          (notification.metadata?.projectName as string) ?? "Project",
          (notification.metadata?.deploymentId as string) ?? "",
          (notification.metadata?.environment as string) ?? "production",
          (notification.metadata?.branch as string) ?? "main",
          (notification.metadata?.error as string) ?? notification.message,
          unsubscribeUrl,
          baseUrl,
        );
        break;
      case "approval_needed":
        template = approvalRequestEmail(
          notification.message,
          (notification.metadata?.taskId as string) ?? "",
          (notification.metadata?.requesterName as string) ?? "System",
          notification.message,
          unsubscribeUrl,
          baseUrl,
        );
        break;
      case "usage_warning":
        template = usageWarningEmail(
          (notification.metadata?.workspaceName as string) ?? "Workspace",
          (notification.metadata?.currentUsage as number) ?? 0,
          (notification.metadata?.threshold as number) ?? 0,
          (notification.metadata?.period as string) ?? "current period",
          unsubscribeUrl,
          baseUrl,
        );
        break;
      default:
        template = taskCompletionEmail(
          notification.message,
          (notification.metadata?.taskId as string) ?? "",
          "completed",
          undefined,
          unsubscribeUrl,
          baseUrl,
        );
        break;
    }

    await sendEmailQueued(
      prisma,
      member.user.email,
      template.subject,
      template.html,
      template.text,
      template.unsubscribeType,
      workspaceId,
      notification.metadata,
    );
  }
}

export async function notifyTaskCompleted(
  prisma: PrismaClient,
  taskId: string,
  workspaceId: string,
): Promise<void> {
  await notifyWorkspace(prisma, workspaceId, {
    type: "task_completed",
    title: "Task Completed",
    message: `Task ${taskId} has completed successfully.`,
    metadata: { taskId },
  }, "task_completed");
}

export async function notifyTaskFailed(
  prisma: PrismaClient,
  taskId: string,
  workspaceId: string,
  error: string,
): Promise<void> {
  await notifyWorkspace(prisma, workspaceId, {
    type: "task_failed",
    title: "Task Failed",
    message: `Task ${taskId} has failed: ${error}`,
    metadata: { taskId, error },
  }, "task_failed");
}

export async function notifyDeploymentReady(
  prisma: PrismaClient,
  deploymentId: string,
  projectId: string,
  workspaceId: string,
  url: string,
): Promise<void> {
  await notifyWorkspace(prisma, workspaceId, {
    type: "deployment_ready",
    title: "Deployment Ready",
    message: `Deployment ${deploymentId} is ready at ${url}`,
    metadata: { deploymentId, projectId, url },
  }, "deployment_ready");
}

export async function notifyDeploymentFailed(
  prisma: PrismaClient,
  deploymentId: string,
  projectId: string,
  workspaceId: string,
  error: string,
): Promise<void> {
  await notifyWorkspace(prisma, workspaceId, {
    type: "deployment_failed",
    title: "Deployment Failed",
    message: `Deployment ${deploymentId} has failed: ${error}`,
    metadata: { deploymentId, projectId, error },
  }, "deployment_failed");
}
