import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckpointManager } from "./checkpoint-manager.js";

function createMockPrisma() {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    checkpoint: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function createMockEvents() {
  return {
    publishAndEmit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("CheckpointManager", () => {
  let manager: CheckpointManager;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockEvents: ReturnType<typeof createMockEvents>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockEvents = createMockEvents();
    manager = new CheckpointManager(mockPrisma as never, mockEvents as never);
  });

  it("lists checkpoints for a task", async () => {
    mockPrisma.checkpoint.findMany.mockResolvedValueOnce([
      {
        id: "cp-1",
        taskId: "task-1",
        projectId: "proj-1",
        checkpointType: "PRE_EXECUTION",
        stateReference: { kind: "git", ref: "abc123" },
        createdAt: new Date(),
      },
    ]);

    const checkpoints = await manager.listCheckpoints("task-1");
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.id).toBe("cp-1");
  });

  it("gets a specific checkpoint", async () => {
    mockPrisma.checkpoint.findUnique.mockResolvedValueOnce({
      id: "cp-1",
      taskId: "task-1",
      projectId: "proj-1",
      checkpointType: "PRE_EXECUTION",
      stateReference: { kind: "git", ref: "abc123" },
      createdAt: new Date(),
    });

    const checkpoint = await manager.getCheckpoint("cp-1");
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.id).toBe("cp-1");
  });

  it("returns null for non-existent checkpoint", async () => {
    const checkpoint = await manager.getCheckpoint("non-existent");
    expect(checkpoint).toBeNull();
  });

  it("cleans up old checkpoints", async () => {
    mockPrisma.checkpoint.findMany.mockResolvedValueOnce([
      { id: "cp-1", createdAt: new Date("2024-01-01") },
      { id: "cp-2", createdAt: new Date("2024-01-02") },
      { id: "cp-3", createdAt: new Date("2024-01-03") },
      { id: "cp-4", createdAt: new Date("2024-01-04") },
      { id: "cp-5", createdAt: new Date("2024-01-05") },
      { id: "cp-6", createdAt: new Date("2024-01-06") },
    ]);
    mockPrisma.checkpoint.deleteMany.mockResolvedValueOnce({ count: 1 });

    const deleted = await manager.cleanupCheckpoints("task-1", 5);
    expect(deleted).toBe(1);
    expect(mockPrisma.checkpoint.deleteMany).toHaveBeenCalled();
  });

  it("skips cleanup when checkpoint count is within limit", async () => {
    mockPrisma.checkpoint.findMany.mockResolvedValueOnce([
      { id: "cp-1", createdAt: new Date() },
      { id: "cp-2", createdAt: new Date() },
    ]);

    const deleted = await manager.cleanupCheckpoints("task-1", 5);
    expect(deleted).toBe(0);
    expect(mockPrisma.checkpoint.deleteMany).not.toHaveBeenCalled();
  });
});
