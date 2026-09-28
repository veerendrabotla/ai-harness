import type { PrismaClient } from "@prisma/client";
import type { EventActorType } from "@ai-harness/contracts";
import {
  isTerminalState,
  resolveTransition,
  TASK_EVENT_TYPES,
  type TaskState,
} from "@ai-harness/domain";
import { errors } from "@ai-harness/shared";

/**
 * State Machine service — the ONLY writer of tasks.state / task_runs.state.
 * Every transition is validated against the centralized XState-backed machine
 * and persisted together with a STATE_CHANGED event (FR-005).
 */
export class TaskStateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly publish: (input: {
      taskId: string;
      runId?: string | null;
      eventType: string;
      actorType: EventActorType;
      payload?: Record<string, unknown>;
    }) => Promise<void>,
  ) {}

  async transition(input: {
    taskId: string;
    runId: string | null;
    from: TaskState;
    to: TaskState;
    actorType?: EventActorType;
    reason?: string;
  }): Promise<TaskState> {
    // Terminal pinning is an idempotent no-op (job retries after transient faults).
    if (input.from === input.to && isTerminalState(input.to)) {
      return input.to;
    }

    // Re-read authoritative state first: another actor (e.g. user cancellation)
    // may have moved the task since this run stage began.
    const current = await this.prisma.task.findUniqueOrThrow({
      where: { id: input.taskId },
      select: { state: true },
    });
    if (current.state !== input.from) {
      // Idempotent terminal re-entry (e.g. job retry after a transient DB loss):
      // pinning an already-terminal state is a no-op, not an error.
      if (current.state === input.to && isTerminalState(input.to)) {
        return current.state as TaskState;
      }
      return current.state as TaskState; // stale stage — skip gracefully
    }

    resolveTransition(input.from, input.to);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: input.taskId },
        data: {
          state: input.to,
          ...(isTerminalState(input.to) ? { completedAt: now } : {}),
        },
      });
      if (input.runId) {
        await tx.taskRun.update({
          where: { id: input.runId },
          data: {
            state: input.to,
            endedAt: isTerminalState(input.to) ? now : undefined,
          },
        });
      }
    });

    await this.publish({
      taskId: input.taskId,
      runId: input.runId,
      eventType: TASK_EVENT_TYPES.STATE_CHANGED,
      actorType: input.actorType ?? "SYSTEM",
      payload: { from: input.from, to: input.to, reason: input.reason },
    });

    return input.to;
  }

  /** Cancels from any non-terminal state with a CANCELLED edge. */
  async failCancelled(taskId: string, runId: string | null, from: TaskState): Promise<void> {
    await this.transition({
      taskId,
      runId,
      from,
      to: "CANCELLED",
      actorType: "USER",
      reason: "Cancellation requested",
    });
    await this.publish({
      taskId,
      runId,
      eventType: TASK_EVENT_TYPES.RUN_CANCELLED,
      actorType: "USER",
      payload: { reason: "Cancellation requested" },
    });
  }

  /**
   * Marks a run failed: validates the transition, stores failure metadata and
   * emits RUN_FAILED. Used for every structured failure path.
   */
  async failRun(input: {
    taskId: string;
    runId: string;
    from: TaskState;
    failureCode: string;
    failureMessage: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    resolveTransition(input.from, "FAILED");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: input.taskId },
        data: { state: "FAILED", completedAt: now },
      });
      await tx.taskRun.update({
        where: { id: input.runId },
        data: {
          state: "FAILED",
          endedAt: now,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
        },
      });
    });
    await this.publish({
      taskId: input.taskId,
      runId: input.runId,
      eventType: TASK_EVENT_TYPES.RUN_FAILED,
      actorType: "SYSTEM",
      payload: {
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        details: input.details,
      },
    });
  }

  /** Loads current task/run state and asserts the run exists. */
  async loadCurrent(taskId: string, runId: string) {
    const [task, run] = await Promise.all([
      this.prisma.task.findUnique({ where: { id: taskId } }),
      this.prisma.taskRun.findUnique({ where: { id: runId } }),
    ]);
    if (!task || !run || run.taskId !== taskId) throw errors.notFound("Task run");
    return { task, run };
  }

  /**
   * Enforces one active run per task (FR-012) even under concurrent job delivery:
   * a transaction-scoped advisory lock serializes competing creators per task,
   * then the active-run check runs against locked state.
   */
  async createRunExclusively(taskId: string, runId: string): Promise<{ id: string; runNumber: number }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${taskId}, 0))`;
      const activeRuns = await tx.taskRun.count({
        where: { taskId, state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
      });
      if (activeRuns > 0) throw errors.conflict("This task already has an active run");
      const last = await tx.taskRun.aggregate({ where: { taskId }, _max: { runNumber: true } });
      const runNumber = (last._max.runNumber ?? 0) + 1;
      const run = await tx.taskRun.create({
        data: { id: runId, taskId, runNumber, state: "QUEUED" },
      });
      return { id: run.id, runNumber };
    });
  }
}
