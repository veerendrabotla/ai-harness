import { describe, it, expect, vi } from "vitest";
import { sweepStuckRuns, STUCK_RUN_GRACE_MS } from "./stuck-run-sweep.js";

type RunRow = {
  id: string;
  taskId: string;
  task: { state: string };
};

function makeDb(stuck: RunRow[]) {
  const runUpdate = vi.fn().mockResolvedValue({});
  const taskUpdate = vi.fn().mockResolvedValue({});
  const transaction = vi.fn().mockResolvedValue(undefined);
  const findMany = vi.fn().mockResolvedValue(stuck);
  const db = {
    taskRun: { findMany, update: runUpdate },
    task: { update: taskUpdate },
    $transaction: transaction,
  };
  return { db: db as never, findMany, runUpdate, taskUpdate, transaction };
}

function makeEvents() {
  return { publishAndEmit: vi.fn().mockResolvedValue(undefined) };
}

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
}

const staleRun = (id: string, taskId: string, taskState = "EXECUTING"): RunRow => ({
  id,
  taskId,
  task: { state: taskState },
});

describe("Stuck-run recovery sweep", () => {
  it("queries non-terminal runs older than the 15-minute grace period", async () => {
    const { db, findMany } = makeDb([]);
    const now = new Date("2026-01-01T12:00:00.000Z");
    const count = await sweepStuckRuns({ db, events: makeEvents(), logger: makeLogger(), now });

    expect(count).toBe(0);
    const query = findMany.mock.calls[0]?.[0] as {
      where: { state: { notIn: string[] }; startedAt: { lt: Date } };
      take: number;
    };
    expect(query.where.state.notIn).toEqual([
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "INTERRUPTED",
    ]);
    expect(query.where.startedAt.lt).toEqual(
      new Date(now.getTime() - STUCK_RUN_GRACE_MS),
    );
    expect(query.take).toBe(20);
  });

  it("interrupts a stale run, parks the task, and emits RUN_INTERRUPTED", async () => {
    const { db, runUpdate, taskUpdate, transaction } = makeDb([staleRun("run-1", "task-1")]);
    const events = makeEvents();
    const logger = makeLogger();

    const count = await sweepStuckRuns({ db, events, logger });

    expect(count).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { state: "INTERRUPTED" },
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { state: "INTERRUPTED", pauseRequested: false },
    });
    expect(events.publishAndEmit).toHaveBeenCalledWith({
      taskId: "task-1",
      runId: "run-1",
      eventType: "RUN_INTERRUPTED",
      actorType: "SYSTEM",
      payload: { reason: "WORKER_LOST", note: "Recoverable via resume/retry." },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { taskId: "task-1", runId: "run-1" },
      "stuck run marked INTERRUPTED",
    );
  });

  it("never moves a terminal task out of its terminal state (run-only interrupt)", async () => {
    for (const terminal of ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]) {
      const { db, runUpdate, taskUpdate, transaction } = makeDb([
        staleRun("run-t", "task-t", terminal),
      ]);
      const events = makeEvents();

      const count = await sweepStuckRuns({ db, events, logger: makeLogger() });

      expect(count).toBe(1);
      expect(transaction).not.toHaveBeenCalled();
      expect(taskUpdate).not.toHaveBeenCalled();
      expect(runUpdate).toHaveBeenCalledWith({
        where: { id: "run-t" },
        data: { state: "INTERRUPTED" },
      });
      expect(events.publishAndEmit).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-t", eventType: "RUN_INTERRUPTED" }),
      );
    }
  });

  it("honors a custom limit and clock", async () => {
    const { db, findMany } = makeDb([]);
    const now = new Date("2026-06-01T00:00:00.000Z");
    await sweepStuckRuns({ db, events: makeEvents(), logger: makeLogger(), now, limit: 5 });
    const query = findMany.mock.calls[0]?.[0] as { take: number };
    expect(query.take).toBe(5);
  });
});
