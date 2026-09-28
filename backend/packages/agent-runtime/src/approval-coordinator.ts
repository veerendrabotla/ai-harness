import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { errors } from "@ai-harness/shared";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import type { EventPublisher } from "./event-publisher.js";

const APPROVAL_TTL_MS = 15 * 60 * 1000;

/**
 * Approval Coordinator (AGENT_RUNTIME.md §12 / APP_FLOW §9).
 * Creates, expires and resolves approval requests. An agent can NEVER approve
 * its own request — decisions always carry an authenticated user id.
 */
export class ApprovalCoordinator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventPublisher,
    private readonly onCreated?: (approval: { id: string; taskId: string; toolCallId: string | null; status: string; requestedScope: string; expiresAt: Date; workspaceId?: string }) => void,
  ) {}

  async createToolApproval(input: {
    taskId: string;
    runId: string;
    toolCallId: string;
    requestedScope?: "ONCE" | "TASK";
  }) {
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
    const approval = await this.prisma.approvalRequest.create({
      data: {
        id: randomUUID(),
        taskId: input.taskId,
        toolCallId: input.toolCallId,
        requestedScope: input.requestedScope ?? "ONCE",
        status: "PENDING",
        requestedByActor: "AGENT",
        expiresAt,
      },
    });
    this.onCreated?.(approval);
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: input.runId,
      eventType: TASK_EVENT_TYPES.TOOL_REQUESTED,
      actorType: "AGENT",
      payload: {
        approvalId: approval.id,
        toolCallId: input.toolCallId,
        scope: approval.requestedScope,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return approval;
  }

  async resolve(input: {
    approvalId: string;
    userId: string;
    approved: boolean;
  }) {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: input.approvalId },
      include: { toolCall: true },
    });
    if (!approval) throw errors.notFound("Approval request");
    if (approval.status === "EXPIRED") throw errors.approvalExpired();
    if (approval.status !== "PENDING") {
      throw errors.conflict(`Approval already resolved (${approval.status})`);
    }
    if (approval.expiresAt.getTime() < Date.now()) {
      await this.prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { status: "EXPIRED" },
      });
      await this.events.publishAndEmit({
        taskId: approval.taskId,
        runId: null,
        eventType: TASK_EVENT_TYPES.APPROVAL_EXPIRED,
        actorType: "SYSTEM",
        payload: { approvalId: approval.id },
      });
      throw errors.approvalExpired();
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: input.approved ? "APPROVED" : "DENIED",
        decidedBy: input.userId,
        decidedAt: new Date(),
      },
    });

    if (approval.toolCall) {
      await this.prisma.toolCall.update({
        where: { id: approval.toolCall.id },
        data: { status: input.approved ? "PENDING" : "DENIED" },
      });
    }

    await this.events.publishAndEmit({
      taskId: approval.taskId,
      runId: null,
      eventType: input.approved ? TASK_EVENT_TYPES.APPROVAL_GRANTED : TASK_EVENT_TYPES.APPROVAL_DENIED,
      actorType: "USER",
      payload: { approvalId: approval.id, toolCallId: approval.toolCallId, decidedBy: input.userId },
    });

    return updated;
  }

  /** Expires stale pending approvals for a task (sweeper + pre-check). */
  async expirePending(taskId: string): Promise<number> {
    const expired = await this.prisma.approvalRequest.updateMany({
      where: { taskId, status: "PENDING", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
    return expired.count;
  }
}
