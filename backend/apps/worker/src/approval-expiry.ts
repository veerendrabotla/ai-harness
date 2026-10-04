import type { PrismaClient } from "@prisma/client";
import type { TaskJob } from "@ai-harness/shared";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";

export interface ApprovalExpiryDeps {
  db: PrismaClient;
  events: {
    publishAndEmit(input: {
      taskId: string;
      runId: string | null;
      eventType: string;
      actorType: "USER" | "AGENT" | "SYSTEM" | "TOOL" | "BRIDGE";
      payload?: Record<string, unknown>;
    }): Promise<unknown>;
  };
  /** Enqueues `{ kind: "continue-after-tool-decision" }` so the run resumes. */
  enqueue: (job: TaskJob) => Promise<void>;
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    warn(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
  /** Injectable clock for tests. */
  now?: Date;
  /** Max approvals to expire per sweep cycle. */
  limit?: number;
}

/**
 * Approval expiry (APP_FLOW §14 / permissions-and-approvals §4c): marks stale
 * PENDING approvals EXPIRED, denies their tool calls, publishes
 * APPROVAL_EXPIRED, and — crucially — enqueues `continue-after-tool-decision`
 * so the awaiting run resumes (treated like a denial: replan or a fresh
 * approval). Without the continuation the task would sit in
 * WAITING_FOR_TOOL_APPROVAL forever (observed with scheduled tasks).
 *
 * The claim is conditional on `status: "PENDING"` so a racing user decision
 * and this sweeper can never both fire; the deterministic jobId
 * (`continue-after-tool-decision-<taskId>-<approvalId>`) makes a duplicate
 * enqueue a no-op.
 *
 * Returns the number of approvals expired.
 */
export async function expireStaleApprovals(deps: ApprovalExpiryDeps): Promise<number> {
  const { db, events, enqueue, logger } = deps;
  const now = deps.now ?? new Date();
  const stale = await db.approvalRequest.findMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" },
    take: deps.limit ?? 50,
  });

  let expired = 0;
  for (const approval of stale) {
    const claimed = await db.approvalRequest.updateMany({
      where: { id: approval.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (claimed.count === 0) continue;

    if (approval.toolCallId) {
      await db.toolCall.updateMany({
        where: { id: approval.toolCallId, status: "WAITING_APPROVAL" },
        data: { status: "DENIED" },
      });
    }
    await events.publishAndEmit({
      taskId: approval.taskId,
      runId: null,
      eventType: TASK_EVENT_TYPES.APPROVAL_EXPIRED,
      actorType: "SYSTEM",
      payload: { approvalId: approval.id },
    });
    try {
      await enqueue({ kind: "continue-after-tool-decision", taskId: approval.taskId, approvalId: approval.id });
    } catch (err) {
      logger.warn(
        { approvalId: approval.id, taskId: approval.taskId, err: (err as Error).message },
        "approval expired but continuation enqueue failed",
      );
    }
    logger.info({ approvalId: approval.id, taskId: approval.taskId }, "approval expired");
    expired++;
  }
  return expired;
}
