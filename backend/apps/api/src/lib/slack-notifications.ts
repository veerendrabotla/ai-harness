/**
 * Slack Notification Integration.
 * Sends notifications to Slack channels via incoming webhooks.
 */
import type { PrismaClient } from "@prisma/client";
import { getEnv } from "@ai-harness/shared";
import pino from "pino";

const log = pino({ name: "slack-notifications", level: "warn" });

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
}

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

/**
 * Send a message to a Slack incoming webhook URL.
 */
async function sendToSlack(webhookUrl: string, message: SlackMessage): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch (err) {
    log.error({ err }, "[Slack] Failed to send notification:");
    return false;
  }
}

/**
 * Get the Slack webhook URL for a workspace from notification preferences.
 */
async function getSlackWebhookUrl(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<string | null> {
  // Check workspace-level Slack webhook setting stored in metadata
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { webhookUrls: true },
  });

  // Look for a Slack webhook URL in the workspace webhook URLs
  const slackUrl = workspace?.webhookUrls?.find((url) =>
    url.includes("hooks.slack.com"),
  );
  return slackUrl ?? null;
}

/**
 * Check if a user has Slack notifications enabled.
 */
export async function userHasSlackEnabled(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPreferences: true },
  });
  const prefs = user?.notificationPreferences as Record<string, unknown> | null;
  return prefs?.slack === true;
}

/**
 * Send a task completion notification to Slack.
 */
export async function sendTaskSlackNotification(
  prisma: PrismaClient,
  workspaceId: string,
  taskId: string,
  status: "completed" | "failed",
  taskGoal: string,
): Promise<void> {
  const webhookUrl = await getSlackWebhookUrl(prisma, workspaceId);
  if (!webhookUrl) return;

  const icon = status === "completed" ? ":white_check_mark:" : ":x:";
  const frontendUrl = getEnv().FRONTEND_ORIGIN;

  const message: SlackMessage = {
    text: `${icon} Task ${status}: ${taskGoal.slice(0, 100)}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `${icon} *Task ${status}*` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Task:*\n${taskGoal.slice(0, 100)}` },
          { type: "mrkdwn", text: `*Status:*\n${status.toUpperCase()}` },
        ],
      },
      {
        type: "actions",
        elements: [
          { type: "mrkdwn", text: `<${frontendUrl}/tasks/${taskId}|View Task>` },
        ],
      },
    ],
  };

  await sendToSlack(webhookUrl, message);
}

/**
 * Send a deployment notification to Slack.
 */
export async function sendDeploymentSlackNotification(
  prisma: PrismaClient,
  workspaceId: string,
  deploymentId: string,
  projectId: string,
  status: "ready" | "failed",
  environment: string,
): Promise<void> {
  const webhookUrl = await getSlackWebhookUrl(prisma, workspaceId);
  if (!webhookUrl) return;

  const icon = status === "ready" ? ":rocket:" : ":boom:";
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });

  const message: SlackMessage = {
    text: `${icon} Deployment ${status} on ${project?.name ?? "unknown"}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `${icon} *Deployment ${status}*` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Project:*\n${project?.name ?? "unknown"}` },
          { type: "mrkdwn", text: `*Environment:*\n${environment}` },
        ],
      },
    ],
  };

  await sendToSlack(webhookUrl, message);
}
