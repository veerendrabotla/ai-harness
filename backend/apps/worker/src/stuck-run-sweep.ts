import type { PrismaClient } from "@prisma/client";

/** Runs active for longer than this without progress are considered lost. */
export const STUCK_RUN_GRACE_MS = 15 * 60_000;

const TERMINAL_TASK_STATES = ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"] as const;

export type SweepActorType = "USER" | "AGENT" | "SYSTEM" | "TOOL" | "BRIDGE";

export interface StuckRunSweepDeps {
  db: PrismaClient;
  events: {
    publishAndEmit(input: {
      taskId: string;
      runId: string;
      eventType: string;
      actorType: SweepActorType;
      payload?: Record<string, unknown>;
    }): Promise<unknown>;
  };
  logger: {
    warn(obj: Record<string, unknown>, msg: string): void;
  };
  /** Injectable clock for tests. */
  now?: Date;
  /** Max runs to interrupt per sweep cycle (worker policy). */
  limit?: number;
}

/**
 * Stuck-run recovery (APP_FLOW §14 / AGENT_RUNTIME §6): finds runs left active
 * by a worker that died mid-flight, marks them INTERRUPTED, parks non-terminal
 * tasks at INTERRUPTED, and emits RUN_INTERRUPTED for subscribers.
 *
 * Returns the number of runs interrupted.
 */
export async function sweepStuckRuns(deps: StuckRunSweepDeps): Promise<number> {
  const { db, events, logger } = deps;
  const cutoff = new Date((deps.now ?? new Date()).getTime() - STUCK_RUN_GRACE_MS);
  const stuck = await db.taskRun.findMany({
    where: {
      state: { notIn: [...TERMINAL_TASK_STATES] },
      startedAt: { lt: cutoff },
    },
    include: { task: { select: { state: true } } },
    take: deps.limit ?? 20,
  });

  for (const run of stuck) {
    const taskTerminal = (TERMINAL_TASK_STATES as readonly string[]).includes(run.task.state);
    if (taskTerminal) {
      // Inconsistent state (terminal task, live run): interrupt the run only —
      // never move a completed/failed task back out of its terminal state.
      await db.taskRun.update({ where: { id: run.id }, data: { state: "INTERRUPTED" } });
    } else {
      await db.$transaction([
        db.taskRun.update({ where: { id: run.id }, data: { state: "INTERRUPTED" } }),
        db.task.update({
          where: { id: run.taskId },
          data: { state: "INTERRUPTED", pauseRequested: false },
        }),
      ]);
    }
    await events.publishAndEmit({
      taskId: run.taskId,
      runId: run.id,
      eventType: "RUN_INTERRUPTED",
      actorType: "SYSTEM",
      payload: { reason: "WORKER_LOST", note: "Recoverable via resume/retry." },
    });
    logger.warn({ taskId: run.taskId, runId: run.id }, "stuck run marked INTERRUPTED");
  }

  return stuck.length;
}
