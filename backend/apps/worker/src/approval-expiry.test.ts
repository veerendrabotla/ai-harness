import { describe, it, expect, vi } from "vitest";
import { expireStaleApprovals, type ApprovalExpiryDeps } from "./approval-expiry.js";

type ApprovalRow = {
  id: string;
  taskId: string;
  toolCallId: string | null;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
  expiresAt: Date;
};

const NOW = new Date("2026-10-04T12:20:00.000Z");

function makeApproval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: "00000000-0000-0000-0000-0000000000e1",
    taskId: "00000000-0000-0000-0000-0000000000f1",
    toolCallId: "00000000-0000-0000-0000-0000000000g1",
    status: "PENDING",
    expiresAt: new Date("2026-10-04T12:15:00.000Z"),
    ...overrides,
  };
}

function makeDeps(stale: ApprovalRow[], opts: { claimCount?: number; enqueueError?: boolean } = {}) {
  const claim = vi.fn().mockResolvedValue({ count: opts.claimCount ?? 1 });
  const toolUpdate = vi.fn().mockResolvedValue({});
  const db = {
    approvalRequest: {
      findMany: vi.fn().mockResolvedValue(stale),
      updateMany: claim,
    },
    toolCall: { updateMany: toolUpdate },
  };
  const events = { publishAndEmit: vi.fn().mockResolvedValue(undefined) };
  const enqueue = opts.enqueueError
    ? vi.fn().mockRejectedValue(new Error("redis down"))
    : vi.fn().mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: ApprovalExpiryDeps = { db: db as never, events, enqueue, logger, now: NOW };
  return { deps, db, events, enqueue, logger, claim, toolUpdate };
}

describe("Approval expiry sweep — due detection", () => {
  it("queries only stale PENDING approvals, oldest first, capped at 50", async () => {
    const { deps, db } = makeDeps([]);
    const count = await expireStaleApprovals(deps);

    expect(count).toBe(0);
    const query = db.approvalRequest.findMany.mock.calls[0]?.[0] as {
      where: { status: string; expiresAt: { lt: Date } };
      orderBy: { expiresAt: string };
      take: number;
    };
    expect(query.where).toEqual({ status: "PENDING", expiresAt: { lt: NOW } });
    expect(query.orderBy.expiresAt).toBe("asc");
    expect(query.take).toBe(50);
  });
});

describe("Approval expiry sweep — expiring", () => {
  it("conditionally claims EXPIRED, denies the tool call, publishes, and resumes the run", async () => {
    const approval = makeApproval();
    const { deps, claim, toolUpdate, events, enqueue } = makeDeps([approval]);

    const count = await expireStaleApprovals(deps);
    expect(count).toBe(1);

    expect(claim).toHaveBeenCalledWith({
      where: { id: approval.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    expect(toolUpdate).toHaveBeenCalledWith({
      where: { id: approval.toolCallId, status: "WAITING_APPROVAL" },
      data: { status: "DENIED" },
    });
    expect(events.publishAndEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: approval.taskId,
        runId: null,
        eventType: "APPROVAL_EXPIRED",
        actorType: "SYSTEM",
        payload: { approvalId: approval.id },
      }),
    );
    // The resume: without this the task hangs in WAITING_FOR_TOOL_APPROVAL.
    expect(enqueue).toHaveBeenCalledWith({
      kind: "continue-after-tool-decision",
      taskId: approval.taskId,
      approvalId: approval.id,
    });
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: approval.id }),
      "approval expired",
    );
  });

  it("expires even when the tool call link is missing", async () => {
    const approval = makeApproval({ toolCallId: null });
    const { deps, toolUpdate, enqueue } = makeDeps([approval]);

    const count = await expireStaleApprovals(deps);
    expect(count).toBe(1);
    expect(toolUpdate).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("still counts the expiry when the continuation enqueue fails (warn only)", async () => {
    const { deps, enqueue, logger } = makeDeps([makeApproval()], { enqueueError: true });

    const count = await expireStaleApprovals(deps);
    expect(count).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "00000000-0000-0000-0000-0000000000f1" }),
      expect.stringContaining("continuation enqueue failed"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: "00000000-0000-0000-0000-0000000000e1" }),
      "approval expired",
    );
  });
});

describe("Approval expiry sweep — guards", () => {
  it("does nothing when losing the claim race to a user decision", async () => {
    const approval = makeApproval();
    const { deps, toolUpdate, events, enqueue } = makeDeps([approval], { claimCount: 0 });

    const count = await expireStaleApprovals(deps);
    expect(count).toBe(0);
    expect(toolUpdate).not.toHaveBeenCalled();
    expect(events.publishAndEmit).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("honors the per-cycle limit", async () => {
    const { deps, db } = makeDeps([]);
    await expireStaleApprovals(deps);
    const query = db.approvalRequest.findMany.mock.calls[0]?.[0] as { take: number };
    expect(query.take).toBe(50);
  });
});
