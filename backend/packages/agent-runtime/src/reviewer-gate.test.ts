import { describe, it, expect, vi } from "vitest";
import { buildAgentRuntime } from "./runtime.js";
import type { RunInput } from "./run-input.js";

type ReviewResult = { blocking: string[]; non_blocking: string[]; confidence: string } | null;

type GateInternals = {
  executionLoop: (
    input: RunInput,
    runId: string,
    ctx: unknown,
    budget: unknown,
    deadline: number,
    abortSignal?: AbortSignal,
    traceId?: string,
  ) => Promise<string>;
  events: { publishAndEmit: (input: { eventType: string }) => Promise<unknown> & { mock?: unknown } };
  runReview: (...args: unknown[]) => Promise<ReviewResult>;
  runSecurityScan: (...args: unknown[]) => Promise<{ findings: unknown[] }>;
  verification: { verify: (...args: unknown[]) => Promise<unknown[]> };
  state: { transition: (...args: unknown[]) => Promise<unknown> };
  fireHooks: (...args: unknown[]) => Promise<unknown>;
  checkpoints: Record<string, unknown>;
};

function createGateHarness(opts: { blockOnReviewFindings: boolean; review: ReviewResult }) {
  const prisma = {
    $transaction: vi.fn().mockResolvedValue(undefined),
    task: { findUnique: vi.fn().mockResolvedValue({ state: "EXECUTING" }) },
    taskRun: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
    taskPlan: {
      findFirst: vi.fn().mockResolvedValue({
        id: "plan-1",
        analysis: "",
        affectedFiles: [],
        steps: [],
        risks: [],
        verificationPlan: [],
        status: "APPROVED",
        version: 1,
      }),
    },
    taskEvent: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    toolCall: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    approvalRequest: { findMany: vi.fn().mockResolvedValue([]) },
    checkpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    projectMemory: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() };

  const runtime = buildAgentRuntime({ prisma: prisma as never, logger: logger as never });
  const orch = runtime.orchestrator as unknown as GateInternals;

  const published: Array<{ eventType: string }> = [];
  const transitions: Array<{ from?: string; to?: string }> = [];

  orch.events = {
    publishAndEmit: vi.fn(async (input: { eventType: string; from?: string; to?: string }) => {
      published.push({ eventType: input.eventType });
    }) as never,
  };
  orch.state = {
    transition: vi.fn(async (input: { from?: string; to?: string }) => {
      transitions.push({ from: input.from, to: input.to });
      return input.to;
    }) as never,
  };
  orch.fireHooks = vi.fn().mockResolvedValue(undefined) as never;
  orch.checkpoints = { tryCreatePreExecution: vi.fn().mockResolvedValue(undefined), tryCreatePreStep: vi.fn().mockResolvedValue(undefined) };
  orch.verification = { verify: vi.fn().mockResolvedValue([]) } as never;
  orch.runSecurityScan = vi.fn().mockResolvedValue({ findings: [] }) as never;
  orch.runReview = vi.fn().mockResolvedValue(opts.review) as never;

  const input = {
    taskId: "task-gate",
    runId: "run-gate",
    workspaceId: "ws-1",
    projectId: "proj-1",
    userId: "user-1",
    goal: "reviewer gate flip test",
    constraints: null,
    agentMode: "BUILD",
    selectedModelMode: "ROUTED",
    modelOverride: null,
    workspaceInstructionVersion: null,
    policySnapshotId: "snap-1",
  } as unknown as RunInput;

  const ctx = {
    task: { id: "task-gate" },
    workspace: { status: "ACTIVE", name: "ws" },
    project: { status: "AVAILABLE", connectionType: "CLOUD", rootReference: "/" },
    snapshot: { blockOnReviewFindings: opts.blockOnReviewFindings },
    instructions: null,
    projectAnalysis: null,
  };

  const budget = {
    maxDurationMs: 60_000,
    maxModelInvocations: 12,
    maxToolCalls: 50,
    maxReplans: 3,
    toolCallsUsed: 0,
    modelInvocationsUsed: 0,
    replansUsed: 0,
  };

  const run = (): Promise<string> =>
    orch.executionLoop(input, "run-gate", ctx, budget, Date.now() + 60_000);

  return { orch, published, transitions, run };
}

describe("Reviewer gate flip (F-16 blockOnReviewFindings)", () => {
  it("BLOCK + policy ON: fails the run with REVIEW_BLOCKED and publishes RUN_BLOCKED_BY_REVIEW", async () => {
    const harness = createGateHarness({
      blockOnReviewFindings: true,
      review: { blocking: ["Unsafe eval in src/x.ts"], non_blocking: [], confidence: "high" },
    });

    await expect(harness.run()).rejects.toMatchObject({ name: "REVIEW_BLOCKED" });

    expect(harness.published.map((p) => p.eventType)).toContain("RUN_BLOCKED_BY_REVIEW");
    // Must NOT have released the run to COMPLETED.
    expect(harness.transitions).not.toContainEqual({ from: "REVIEWING", to: "COMPLETED" });
    expect(harness.transitions).toContainEqual({ from: "VERIFYING", to: "REVIEWING" });
  });

  it("BLOCK + policy OFF: blocking findings are advisory — run releases to COMPLETED", async () => {
    const harness = createGateHarness({
      blockOnReviewFindings: false,
      review: { blocking: ["Unsafe eval in src/x.ts"], non_blocking: ["naming nit"], confidence: "high" },
    });

    await expect(harness.run()).resolves.toBe("COMPLETED");

    expect(harness.published.map((p) => p.eventType)).not.toContain("RUN_BLOCKED_BY_REVIEW");
    expect(harness.transitions).toContainEqual({ from: "REVIEWING", to: "COMPLETED" });
  });

  it("PASS (empty blocking) + policy ON: run releases to COMPLETED", async () => {
    const harness = createGateHarness({
      blockOnReviewFindings: true,
      review: { blocking: [], non_blocking: ["consider renaming"], confidence: "medium" },
    });

    await expect(harness.run()).resolves.toBe("COMPLETED");

    expect(harness.published.map((p) => p.eventType)).not.toContain("RUN_BLOCKED_BY_REVIEW");
    expect(harness.transitions).toContainEqual({ from: "REVIEWING", to: "COMPLETED" });
  });

  it("review skipped (null) + policy ON: REVIEW_SKIPPED path releases to COMPLETED", async () => {
    const harness = createGateHarness({ blockOnReviewFindings: true, review: null });

    await expect(harness.run()).resolves.toBe("COMPLETED");

    expect(harness.transitions).toContainEqual({ from: "REVIEWING", to: "COMPLETED" });
  });
});
