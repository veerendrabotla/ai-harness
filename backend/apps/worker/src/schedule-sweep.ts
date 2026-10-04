import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { computeNextRun, type TaskJob } from "@ai-harness/shared";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";

const TERMINAL_TASK_STATES = ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"] as const;

export type SweepActorType = "USER" | "AGENT" | "SYSTEM" | "TOOL" | "BRIDGE";

export interface ScheduleSweepDeps {
  db: PrismaClient;
  events: {
    publishAndEmit(input: {
      taskId: string;
      runId: string | null;
      eventType: string;
      actorType: SweepActorType;
      payload?: Record<string, unknown>;
    }): Promise<unknown>;
  };
  /** Enqueues a `{ kind: "start" }` job (BullMQ jobId `start-<taskId>`). */
  enqueue: (job: TaskJob) => Promise<void>;
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    warn(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
  /** Injectable clock for tests. */
  now?: Date;
  /** Max schedules to consider per sweep cycle. */
  limit?: number;
}

/**
 * Scheduled tasks (APP_FLOW §18): finds due enabled schedules, atomically
 * claims each by advancing `nextRunAt` (conditional update — safe against
 * concurrent workers), skips schedules whose previous task is still running,
 * creates a QUEUED task mirroring POST /v1/tasks, emits RUN_STARTED, and
 * enqueues it on the task-lifecycle queue. Completion then flows through the
 * normal pipeline (plans → approvals → verification → notifications).
 *
 * Returns the number of schedules fired.
 */
export async function sweepDueSchedules(deps: ScheduleSweepDeps): Promise<number> {
  const { db, events, enqueue, logger } = deps;
  const now = deps.now ?? new Date();
  const due = await db.taskSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: deps.limit ?? 10,
  });

  let fired = 0;
  for (const schedule of due) {
    let next: Date;
    try {
      next = computeNextRun(schedule, now);
    } catch (err) {
      logger.error({ scheduleId: schedule.id, err: (err as Error).message }, "invalid schedule cadence; skipping");
      continue;
    }

    // Atomic claim: only one worker advances this schedule's nextRunAt.
    const claimed = await db.taskSchedule.updateMany({
      where: { id: schedule.id, enabled: true, nextRunAt: schedule.nextRunAt },
      data: { nextRunAt: next },
    });
    if (claimed.count === 0) continue;

    // Overlap guard: skip this cycle if the previous fired task is live.
    if (schedule.lastTaskId) {
      const prev = await db.task.findUnique({
        where: { id: schedule.lastTaskId },
        select: { state: true },
      });
      if (prev && !(TERMINAL_TASK_STATES as readonly string[]).includes(prev.state)) {
        logger.info(
          { scheduleId: schedule.id, taskId: schedule.lastTaskId, state: prev.state },
          "schedule skipped: previous task still running",
        );
        continue;
      }
    }

    const project = await db.project.findFirst({
      where: { id: schedule.projectId, status: "AVAILABLE" },
      select: { id: true },
    });
    if (!project) {
      logger.warn({ scheduleId: schedule.id, projectId: schedule.projectId }, "schedule skipped: project unavailable");
      continue;
    }

    try {
      const task = await db.task.create({
        data: {
          id: randomUUID(),
          workspaceId: schedule.workspaceId,
          projectId: schedule.projectId,
          createdBy: schedule.createdBy,
          goal: schedule.goal,
          constraints: schedule.constraints,
          state: "QUEUED",
          agentMode: "BUILD",
          selectedModelMode: "ROUTED",
        },
      });
      await events.publishAndEmit({
        taskId: task.id,
        runId: null,
        eventType: TASK_EVENT_TYPES.RUN_STARTED,
        actorType: "SYSTEM",
        payload: { createdBy: schedule.createdBy, note: "scheduled task queued", scheduleId: schedule.id },
      });
      try {
        await enqueue({ kind: "start", taskId: task.id });
      } catch (err) {
        // Leave task QUEUED — the worker's orphan sweeper re-enqueues it.
        logger.warn(
          { scheduleId: schedule.id, taskId: task.id, err: (err as Error).message },
          "scheduled task enqueue failed; orphan sweeper will retry",
        );
      }
      await db.taskSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, lastTaskId: task.id },
      });
      logger.info({ scheduleId: schedule.id, taskId: task.id }, "scheduled task fired");
      fired++;
    } catch (err) {
      logger.error(
        { scheduleId: schedule.id, err: (err as Error).message },
        "failed to fire scheduled task",
      );
    }
  }

  return fired;
}
