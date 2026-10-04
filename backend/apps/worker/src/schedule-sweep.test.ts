import { describe, it, expect, vi } from "vitest";
import { sweepDueSchedules, type ScheduleSweepDeps } from "./schedule-sweep.js";

type ScheduleRow = {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  name: string;
  goal: string;
  constraints: string | null;
  cadence: "EVERY_MINUTES" | "HOURLY" | "DAILY" | "WEEKLY";
  intervalMinutes: number | null;
  minuteOfHour: number | null;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const NOW = new Date("2026-10-04T12:00:30.000Z");

function makeSchedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "00000000-0000-0000-0000-0000000000a1",
    workspaceId: "00000000-0000-0000-0000-0000000000b1",
    projectId: "00000000-0000-0000-0000-0000000000c1",
    createdBy: "00000000-0000-0000-0000-0000000000d1",
    name: "Nightly build",
    goal: "Run the nightly build and report failures",
    constraints: null,
    cadence: "EVERY_MINUTES",
    intervalMinutes: 5,
    minuteOfHour: null,
    timeOfDay: null,
    dayOfWeek: null,
    enabled: true,
    nextRunAt: new Date("2026-10-04T12:00:00.000Z"),
    lastRunAt: null,
    lastTaskId: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDeps(due: ScheduleRow[], opts: { claimCount?: number; prevTaskState?: string | null; projectOk?: boolean; enqueueError?: boolean } = {}) {
  const taskCreate = vi.fn().mockResolvedValue({ id: "task-1" });
  const claim = vi.fn().mockResolvedValue({ count: opts.claimCount ?? 1 });
  const scheduleUpdate = vi.fn().mockResolvedValue({});
  const findUniqueTask = vi.fn().mockResolvedValue(
    opts.prevTaskState ? { state: opts.prevTaskState } : null,
  );
  const findFirstProject = vi.fn().mockResolvedValue(
    opts.projectOk === false ? null : { id: "00000000-0000-0000-0000-0000000000c1" },
  );
  const db = {
    taskSchedule: {
      findMany: vi.fn().mockResolvedValue(due),
      updateMany: claim,
      update: scheduleUpdate,
    },
    task: { create: taskCreate, findUnique: findUniqueTask },
    project: { findFirst: findFirstProject },
  };
  const events = { publishAndEmit: vi.fn().mockResolvedValue(undefined) };
  const enqueue = opts.enqueueError
    ? vi.fn().mockRejectedValue(new Error("redis down"))
    : vi.fn().mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: ScheduleSweepDeps = { db: db as never, events, enqueue, logger, now: NOW };
  return { deps, db, events, enqueue, logger, claim, taskCreate, scheduleUpdate, findUniqueTask, findFirstProject };
}

describe("Schedule sweep — due detection", () => {
  it("queries only enabled schedules whose nextRunAt is due, oldest first", async () => {
    const { deps, db } = makeDeps([]);
    const count = await sweepDueSchedules(deps);

    expect(count).toBe(0);
    const query = db.taskSchedule.findMany.mock.calls[0]?.[0] as {
      where: { enabled: boolean; nextRunAt: { lte: Date } };
      orderBy: { nextRunAt: string };
      take: number;
    };
    expect(query.where).toEqual({ enabled: true, nextRunAt: { lte: NOW } });
    expect(query.orderBy.nextRunAt).toBe("asc");
    expect(query.take).toBe(10);
  });
});

describe("Schedule sweep — firing", () => {
  it("claims by advancing nextRunAt, creates a QUEUED task, emits, enqueues, and records the run", async () => {
    const schedule = makeSchedule();
    const { deps, claim, taskCreate, scheduleUpdate, events, enqueue } = makeDeps([schedule]);

    const count = await sweepDueSchedules(deps);
    expect(count).toBe(1);

    // Atomic claim: conditional on the observed nextRunAt, advances to +5 min.
    expect(claim).toHaveBeenCalledWith({
      where: { id: schedule.id, enabled: true, nextRunAt: schedule.nextRunAt },
      data: { nextRunAt: new Date("2026-10-04T12:05:00.000Z") },
    });

    expect(taskCreate).toHaveBeenCalledTimes(1);
    const createData = taskCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(createData.state).toBe("QUEUED");
    expect(createData.workspaceId).toBe(schedule.workspaceId);
    expect(createData.projectId).toBe(schedule.projectId);
    expect(createData.createdBy).toBe(schedule.createdBy);
    expect(createData.goal).toBe(schedule.goal);
    expect(createData.agentMode).toBe("BUILD");
    expect(createData.selectedModelMode).toBe("ROUTED");

    expect(events.publishAndEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        runId: null,
        eventType: "RUN_STARTED",
        actorType: "SYSTEM",
        payload: expect.objectContaining({ scheduleId: schedule.id, note: "scheduled task queued" }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith({ kind: "start", taskId: "task-1" });

    expect(scheduleUpdate).toHaveBeenCalledWith({
      where: { id: schedule.id },
      data: { lastRunAt: NOW, lastTaskId: "task-1" },
    });
  });

  it("counts the fire even when enqueue fails (orphan sweeper recovers QUEUED tasks)", async () => {
    const { deps, enqueue, scheduleUpdate, logger } = makeDeps([makeSchedule()], { enqueueError: true });

    const count = await sweepDueSchedules(deps);
    expect(count).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(scheduleUpdate).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1" }),
      expect.stringContaining("orphan sweeper"),
    );
  });
});

describe("Schedule sweep — guards", () => {
  it("skips when the previous fired task is still non-terminal (overlap guard)", async () => {
    const schedule = makeSchedule({ lastTaskId: "prev-task" });
    const { deps, claim, taskCreate, enqueue, logger } = makeDeps([schedule], { prevTaskState: "EXECUTING" });

    const count = await sweepDueSchedules(deps);
    expect(count).toBe(0);
    expect(claim).toHaveBeenCalledTimes(1); // nextRunAt still advances
    expect(taskCreate).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "prev-task", state: "EXECUTING" }),
      expect.stringContaining("still running"),
    );
  });

  it("fires when the previous task reached a terminal state", async () => {
    const schedule = makeSchedule({ lastTaskId: "prev-task" });
    const { deps, taskCreate } = makeDeps([schedule], { prevTaskState: "COMPLETED" });

    const count = await sweepDueSchedules(deps);
    expect(count).toBe(1);
    expect(taskCreate).toHaveBeenCalledTimes(1);
  });

  it("does nothing when losing the claim race (another worker advanced the schedule)", async () => {
    const { deps, taskCreate, enqueue } = makeDeps([makeSchedule()], { claimCount: 0 });

    const count = await sweepDueSchedules(deps);
    expect(count).toBe(0);
    expect(taskCreate).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips schedules whose project is no longer AVAILABLE", async () => {
    const { deps, taskCreate, logger } = makeDeps([makeSchedule()], { projectOk: false });

    const count = await sweepDueSchedules(deps);
    expect(count).toBe(0);
    expect(taskCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "00000000-0000-0000-0000-0000000000c1" }),
      expect.stringContaining("project unavailable"),
    );
  });

  it("logs and skips schedules with invalid persisted cadence data", async () => {
    const { deps, taskCreate, logger } = makeDeps([makeSchedule({ cadence: "DAILY", timeOfDay: null })]);

    const count = await sweepDueSchedules(deps);
    expect(count).toBe(0);
    expect(taskCreate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: "00000000-0000-0000-0000-0000000000a1" }),
      expect.stringContaining("invalid schedule cadence"),
    );
  });

  it("honors the per-cycle limit", async () => {
    const { deps, db } = makeDeps([]);
    await sweepDueSchedules(deps);
    const query = db.taskSchedule.findMany.mock.calls[0]?.[0] as { take: number };
    expect(query.take).toBe(10);
  });
});
