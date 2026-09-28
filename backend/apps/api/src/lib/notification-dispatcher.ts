/**
 * Notification Dispatcher.
 * Consumes Redis fan-out events (task lifecycle, approvals, deployments) and
 * dispatches the full notification pipeline: in-app + email (via BullMQ) +
 * webhook subscriptions (via webhook_delivery_log outbox).
 *
 * Every API replica receives the Redis messages, so dispatch is deduplicated
 * with a Redis SET NX key (1h TTL) — only one replica delivers each notification.
 */
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import {
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyWorkspace,
  notifyDeploymentReady,
  notifyDeploymentFailed,
} from "./notifications.js";

const DEDUPE_TTL_SECONDS = 3600;

export interface TaskEventEnvelope {
  taskId: string;
  event: {
    eventType?: string;
    runId?: string | null;
    payload?: Record<string, unknown> | null;
  } | null;
}

export interface ApprovalEventEnvelope {
  id: string;
  taskId: string;
  toolCallId: string | null;
  status: string;
  requestedScope: string;
  expiresAt: string;
  workspaceId?: string;
}

export interface DeploymentStatusEnvelope {
  deploymentId: string;
  status: string;
  failureReason?: string;
}

export interface NotificationDispatcher {
  handleTaskEvent(message: TaskEventEnvelope): Promise<void>;
  handleApprovalCreated(approval: ApprovalEventEnvelope): Promise<void>;
  handleDeploymentStatus(status: DeploymentStatusEnvelope): Promise<void>;
}

interface DispatcherDeps {
  prisma: PrismaClient;
  redis: Redis;
  logger: { warn(obj: object, msg: string): void };
}

export function createNotificationDispatcher({ prisma, redis, logger }: DispatcherDeps): NotificationDispatcher {
  /** Claim the dedupe key before delivering; returns false when another replica won. */
  async function once(key: string, deliver: () => Promise<void>): Promise<void> {
    try {
      const claimed = await redis.set(`notify:dedupe:${key}`, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
      if (claimed !== "OK") return;
      await deliver();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, key }, "notification dispatch failed");
    }
  }

  async function workspaceIdForTask(taskId: string): Promise<string | null> {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { workspaceId: true } });
    return task?.workspaceId ?? null;
  }

  return {
    async handleTaskEvent(message: TaskEventEnvelope): Promise<void> {
      const event = message.event;
      if (!event) return;
      const type = event.eventType;
      if (type !== TASK_EVENT_TYPES.RUN_COMPLETED && type !== TASK_EVENT_TYPES.RUN_FAILED) return;

      const workspaceId = await workspaceIdForTask(message.taskId);
      if (!workspaceId) return;

      const scope = event.runId ?? message.taskId;
      if (type === TASK_EVENT_TYPES.RUN_COMPLETED) {
        await once(`run:${scope}:completed`, () => notifyTaskCompleted(prisma, message.taskId, workspaceId));
      } else {
        const payload = event.payload ?? {};
        const error =
          typeof payload["failureMessage"] === "string" && payload["failureMessage"]
            ? payload["failureMessage"]
            : "Unknown error";
        await once(`run:${scope}:failed`, () => notifyTaskFailed(prisma, message.taskId, workspaceId, error));
      }
    },

    async handleApprovalCreated(approval: ApprovalEventEnvelope): Promise<void> {
      const workspaceId = approval.workspaceId ?? (await workspaceIdForTask(approval.taskId));
      if (!workspaceId) return;
      await once(`approval:${approval.id}`, () =>
        notifyWorkspace(
          prisma,
          workspaceId,
          {
            type: "approval_needed",
            title: "Approval Needed",
            message: `A tool call on task ${approval.taskId} is waiting for your approval.`,
            metadata: {
              taskId: approval.taskId,
              approvalId: approval.id,
              toolCallId: approval.toolCallId,
              requesterName: "Agent",
            },
          },
          "approval_request",
        ),
      );
    },

    async handleDeploymentStatus(status: DeploymentStatusEnvelope): Promise<void> {
      if (status.status !== "READY" && status.status !== "FAILED") return;

      const deployment = await prisma.deployment.findUnique({
        where: { id: status.deploymentId },
        select: {
          id: true,
          projectId: true,
          deploymentUrl: true,
          previewUrl: true,
          project: { select: { workspaceId: true } },
        },
      });
      if (!deployment) return;

      const workspaceId = deployment.project.workspaceId;
      if (status.status === "READY") {
        const url = deployment.deploymentUrl ?? deployment.previewUrl ?? "";
        await once(`deploy:${deployment.id}:ready`, () =>
          notifyDeploymentReady(prisma, deployment.id, deployment.projectId, workspaceId, url),
        );
      } else {
        const error = status.failureReason ?? "Deployment failed";
        await once(`deploy:${deployment.id}:failed`, () =>
          notifyDeploymentFailed(prisma, deployment.id, deployment.projectId, workspaceId, error),
        );
      }
    },
  };
}
