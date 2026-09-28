import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventPublisher } from "./event-publisher.js";

function createMockPrisma() {
  return {
    $transaction: vi.fn().mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return fn({
          taskEvent: {
            aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNumber: 0n } }),
            create: vi.fn().mockImplementation(async ({ data }) => ({
              id: "event-1",
              ...data,
              createdAt: new Date(),
            })),
            findMany: vi.fn().mockResolvedValue([]),
          },
        });
      }
      return {};
    }),
    taskEvent: {
      aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNumber: 0n } }),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: "event-1",
        ...data,
        createdAt: new Date(),
      })),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("EventPublisher", () => {
  let publisher: EventPublisher;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    publisher = new EventPublisher(mockPrisma as never);
  });

  it("publishes an event", async () => {
    const result = await publisher.publish({
      taskId: "task-1",
      eventType: "TASK_CREATED",
      actorType: "SYSTEM",
      payload: { goal: "test" },
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.sequenceNumber).toBeDefined();
  });

  it("replays events for a task", async () => {
    mockPrisma.taskEvent.findMany.mockResolvedValueOnce([
      {
        id: "event-1",
        taskId: "task-1",
        runId: "run-1",
        sequenceNumber: 0n,
        eventType: "TASK_CREATED",
        actorType: "SYSTEM",
        payload: { goal: "test" },
        createdAt: new Date(),
      },
      {
        id: "event-2",
        taskId: "task-1",
        runId: "run-1",
        sequenceNumber: 1n,
        eventType: "RUN_STARTED",
        actorType: "SYSTEM",
        payload: { runNumber: 1 },
        createdAt: new Date(),
      },
    ]);

    const events = await publisher.replay("task-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.eventType).toBe("TASK_CREATED");
    expect(events[1]!.eventType).toBe("RUN_STARTED");
  });

  it("replays events with filters", async () => {
    mockPrisma.taskEvent.findMany.mockResolvedValueOnce([]);

    await publisher.replay("task-1", {
      fromSequence: 0,
      toSequence: 10,
      eventTypes: ["TASK_CREATED"],
      limit: 5,
    });

    expect(mockPrisma.taskEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskId: "task-1" }),
        orderBy: { sequenceNumber: "asc" },
        take: 5,
      }),
    );
  });

  it("replays events for a specific run", async () => {
    mockPrisma.taskEvent.findMany.mockResolvedValueOnce([]);

    await publisher.replayRun("task-1", "run-1");

    expect(mockPrisma.taskEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "task-1", runId: "run-1" },
      }),
    );
  });

  it("gets the latest sequence number", async () => {
    mockPrisma.taskEvent.aggregate.mockResolvedValueOnce({ _max: { sequenceNumber: 42n } });

    const sequence = await publisher.getLatestSequence("task-1");
    expect(sequence).toBe(42);
  });

  it("gets event stats", async () => {
    mockPrisma.taskEvent.findMany.mockResolvedValueOnce([
      { eventType: "TASK_CREATED" },
      { eventType: "RUN_STARTED" },
      { eventType: "TASK_CREATED" },
    ]);

    const stats = await publisher.getEventStats("task-1");
    expect(stats).toEqual({
      TASK_CREATED: 2,
      RUN_STARTED: 1,
    });
  });
});
