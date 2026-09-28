import { describe, it, expect, vi } from "vitest";
import { DEFAULT_RUN_BOUNDS, FAILURE_CODES, type RunBounds } from "@ai-harness/domain";
import { buildAgentRuntime } from "./runtime.js";

type Budget = RunBounds & {
  toolCallsUsed: number;
  modelInvocationsUsed: number;
  replansUsed: number;
};

/** Private-surface view of TaskOrchestrator used by these tests. */
type OrchestratorInternals = {
  assertBudget: (budget: Budget, deadline: number) => void;
  replanAfterFailure: (
    input: { taskId: string; projectId: string; workspaceId: string; userId: string },
    runId: string,
    ctx: { instructions: string },
    budget: Budget,
    failureSummary: string,
  ) => Promise<unknown>;
  events: { publishAndEmit: (...args: unknown[]) => Promise<unknown> };
  fireHooks: (...args: unknown[]) => Promise<unknown>;
  state: { transition: (...args: unknown[]) => Promise<unknown> };
  router: { resolveWithFallbacks: (...args: unknown[]) => Promise<unknown> };
};

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    ...DEFAULT_RUN_BOUNDS,
    toolCallsUsed: 0,
    modelInvocationsUsed: 0,
    replansUsed: 0,
    ...overrides,
  };
}

function createInternals(): OrchestratorInternals {
  const prisma = {
    $transaction: vi.fn().mockImplementation(async (fn: unknown) =>
      typeof fn === "function"
        ? fn({
            taskEvent: {
              aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 0 } }),
              create: vi.fn().mockResolvedValue({}),
            },
          })
        : {},
    ),
    task: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ state: "EXECUTING" }),
    },
    taskRun: { findUnique: vi.fn().mockResolvedValue(null) },
    taskPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    checkpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    projectMemory: { findMany: vi.fn().mockResolvedValue([]) },
    taskEvent: {
      aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 0 } }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  const runtime = buildAgentRuntime({
    prisma: prisma as never,
    logger: logger as never,
  });

  const internals = runtime.orchestrator as unknown as OrchestratorInternals;
  internals.events = { publishAndEmit: vi.fn().mockResolvedValue(undefined) };
  internals.fireHooks = vi.fn().mockResolvedValue(undefined);
  internals.state = { transition: vi.fn().mockResolvedValue(undefined) };
  internals.router = { resolveWithFallbacks: vi.fn().mockRejectedValue(new Error("no route")) };
  return internals;
}

const runInput = {
  taskId: "task-1",
  projectId: "proj-1",
  workspaceId: "ws-1",
  userId: "user-1",
};
const runCtx = { instructions: "" };

describe("Execution-loop bounds (AGENT_RUNTIME.md §6)", () => {
  it("DEFAULT_RUN_BOUNDS carries the documented caps", () => {
    expect(DEFAULT_RUN_BOUNDS).toEqual({
      maxDurationMs: 30 * 60 * 1000,
      maxModelInvocations: 12,
      maxToolCalls: 50,
      maxReplans: 3,
    });
  });

  it("passes a fresh budget with zero usage", () => {
    const orch = createInternals();
    expect(() => orch.assertBudget(makeBudget(), Date.now() + 60_000)).not.toThrow();
  });

  it("throws MAX_DURATION_EXCEEDED when the wall-clock deadline has passed", () => {
    const orch = createInternals();
    expect(() => orch.assertBudget(makeBudget(), Date.now() - 1)).toThrowError(
      /wall-clock budget/,
    );
    try {
      orch.assertBudget(makeBudget(), Date.now() - 1);
      expect.unreachable("assertBudget should throw past deadline");
    } catch (err) {
      expect((err as { name: string }).name).toBe(FAILURE_CODES.MAX_DURATION_EXCEEDED);
    }
  });

  it("throws MAX_TOOL_CALLS_EXCEEDED exactly at the tool-call cap", () => {
    const orch = createInternals();
    const deadline = Date.now() + 60_000;
    expect(() => orch.assertBudget(makeBudget({ toolCallsUsed: 49 }), deadline)).not.toThrow();
    expect(() =>
      orch.assertBudget(makeBudget({ toolCallsUsed: DEFAULT_RUN_BOUNDS.maxToolCalls }), deadline),
    ).toThrowError(/maxToolCalls/);
    try {
      orch.assertBudget(
        makeBudget({ toolCallsUsed: DEFAULT_RUN_BOUNDS.maxToolCalls }),
        deadline,
      );
      expect.unreachable("tool-call cap should throw");
    } catch (err) {
      expect((err as { name: string }).name).toBe(FAILURE_CODES.MAX_TOOL_CALLS_EXCEEDED);
    }
  });

  it("throws MAX_MODEL_INVOCATIONS_EXCEEDED exactly at the model-invocation cap", () => {
    const orch = createInternals();
    const deadline = Date.now() + 60_000;
    expect(() => orch.assertBudget(makeBudget({ modelInvocationsUsed: 11 }), deadline)).not.toThrow();
    try {
      orch.assertBudget(
        makeBudget({ modelInvocationsUsed: DEFAULT_RUN_BOUNDS.maxModelInvocations }),
        deadline,
      );
      expect.unreachable("model-invocation cap should throw");
    } catch (err) {
      expect((err as { name: string }).name).toBe("MAX_MODEL_INVOCATIONS_EXCEEDED");
      expect((err as Error).message).toMatch(/model invocations/);
    }
  });

  it("permits exactly maxReplans replans and fails the next with MAX_REPLANS_EXCEEDED", async () => {
    const orch = createInternals();

    // Third replan (replansUsed 2 -> 3) clears the bound and proceeds into recovery;
    // router is mocked to fail so it stops at providerUnavailable.
    const third = await orch
      .replanAfterFailure(runInput, "run-1", runCtx, makeBudget({ replansUsed: 2 }), "failure 3")
      .then(
        () => null,
        (err: unknown) => err as { name?: string },
      );
    expect(third?.name).not.toBe(FAILURE_CODES.MAX_REPLANS_EXCEEDED);

    // Fourth attempt (replansUsed 3 -> 4 > maxReplans) fails the run.
    const fourth = await orch
      .replanAfterFailure(runInput, "run-1", runCtx, makeBudget({ replansUsed: 3 }), "failure 4")
      .then(
        () => null,
        (err: unknown) => err as { name?: string },
      );
    expect(fourth?.name).toBe(FAILURE_CODES.MAX_REPLANS_EXCEEDED);
  });

  it("counts a replan before evaluating the bound (increment-then-check)", async () => {
    const orch = createInternals();
    const budget = makeBudget({ replansUsed: DEFAULT_RUN_BOUNDS.maxReplans });
    await expect(
      orch.replanAfterFailure(runInput, "run-1", runCtx, budget, "boom"),
    ).rejects.toMatchObject({ name: FAILURE_CODES.MAX_REPLANS_EXCEEDED });
    expect(budget.replansUsed).toBe(DEFAULT_RUN_BOUNDS.maxReplans + 1);
  });
});
