import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEngine } from "./engine.js";
import type { Engine } from "./types.js";

function createMockPrisma() {
  return {
    $transaction: vi.fn().mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return fn({
          taskEvent: {
            aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 0 } }),
            create: vi.fn().mockResolvedValue({}),
          },
        });
      }
      return {};
    }),
    task: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: "task-1", goal: "test", state: "QUEUED", projectId: "proj-1", workspaceId: "ws-1", agentMode: "BUILD", createdAt: new Date(), runs: [], plans: [] }),
    },
    taskRun: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "run-1", taskId: "task-1", state: "RUNNING", startedAt: new Date(), endedAt: null }),
    },
    taskPlan: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: "plan-1", taskId: "task-1", status: "DRAFT", version: 1 }),
    },
    taskEvent: {
      aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 0 } }),
      create: vi.fn().mockResolvedValue({}),
    },
    checkpoint: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "cp-1", taskId: "task-1", projectId: "proj-1", checkpointType: "PRE_EXECUTION", createdAt: new Date() }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe("Engine", () => {
  let engine: Engine;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    engine = createEngine({
      prisma: mockPrisma,
      logger: createMockLogger(),
    });
  });

  describe("getTask", () => {
    it("returns null for non-existent task", async () => {
      const task = await engine.getTask("non-existent");
      expect(task).toBeNull();
    });
  });

  describe("subscribe", () => {
    it("subscribes to events and returns unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = engine.subscribe("task-1", callback);

      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });

    it("allows multiple subscribers", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = engine.subscribe("task-1", callback1);
      const unsub2 = engine.subscribe("task-1", callback2);

      unsub1();
      unsub2();
    });
  });

  describe("listCheckpoints", () => {
    it("returns empty array for task with no checkpoints", async () => {
      const checkpoints = await engine.listCheckpoints("task-1");
      expect(checkpoints).toEqual([]);
    });
  });

  describe("listModels", () => {
    it("returns list of available models", async () => {
      const models = await engine.listModels();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty("provider");
      expect(models[0]).toHaveProperty("model");
      expect(models[0]).toHaveProperty("maxTokens");
    });
  });

  describe("getEventHistory", () => {
    it("returns empty array for task with no events", async () => {
      const events = await engine.getEventHistory("task-1");
      expect(events).toEqual([]);
    });
  });

  describe("dispose", () => {
    it("clears all subscriptions and event history", async () => {
      const callback = vi.fn();
      engine.subscribe("task-1", callback);

      await engine.dispose();

      const events = await engine.getEventHistory("task-1");
      expect(events).toEqual([]);
    });
  });

  describe("pauseTask", () => {
    it("throws for non-existent task", async () => {
      await expect(engine.pauseTask("non-existent")).rejects.toThrow("Task non-existent not found");
    });
  });

  describe("cancelTask", () => {
    it("throws for non-existent task", async () => {
      await expect(engine.cancelTask("non-existent", "user-1")).rejects.toThrow("Task non-existent not found");
    });
  });

  describe("retryTask", () => {
    it("throws for non-existent task", async () => {
      await expect(engine.retryTask("non-existent")).rejects.toThrow("Task non-existent not found");
    });
  });
});
