import { describe, expect, it, vi } from "vitest";
import { buildAgentRuntime } from "./runtime.js";
import type { RunInput } from "./run-input.js";

type VerifyResult = {
  command: string;
  status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED";
  output?: string;
};

type SpecInternals = {
  executionLoop: (
    input: RunInput,
    runId: string,
    ctx: unknown,
    budget: unknown,
    deadline: number,
  ) => Promise<string>;
  events: { publishAndEmit: (...args: unknown[]) => Promise<unknown> };
  state: { transition: (...args: unknown[]) => Promise<unknown> };
  fireHooks: (...args: unknown[]) => Promise<unknown>;
  checkpoints: Record<string, unknown>;
  verification: { verify: (...args: unknown[]) => Promise<VerifyResult[]> };
  runSecurityScan: (...args: unknown[]) => Promise<{ findings: unknown[] }>;
  runReview: (
    ...args: unknown[]
  ) => Promise<{ blocking: string[]; non_blocking: string[]; confidence: string }>;
  proposeNextAction: (...args: unknown[]) => Promise<null>;
  replanAfterFailure: (...args: unknown[]) => Promise<string>;
};

function createSpecHarness(opts: {
  steps: Array<{ id: string; title: string; detail?: string; acceptanceCriteria: string[] }>;
  verificationPlan: Array<{ command: string; asserts: string[] }>;
  verifyResults: VerifyResult[];
}) {
  const prisma = {
    $transaction: vi.fn().mockResolvedValue(undefined),
    task: {
      findUnique: vi.fn().mockResolvedValue({ state: "EXECUTING" }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ state: "EXECUTING", cancelRequested: false, pauseRequested: false }),
    },
    taskRun: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    taskPlan: {
      findFirst: vi.fn().mockResolvedValue({
        id: "plan-1",
        analysis: "",
        affectedFiles: [],
        steps: opts.steps,
        risks: [],
        verificationPlan: opts.verificationPlan,
        status: "APPROVED",
        version: 1,
      }),
    },
    taskEvent: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    toolCall: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "tc-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    approvalRequest: { findMany: vi.fn().mockResolvedValue([]) },
    checkpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    projectMemory: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  const runtime = buildAgentRuntime({ prisma: prisma as never, logger: logger as never });
  const orch = runtime.orchestrator as unknown as SpecInternals;

  const transitions: Array<{ from?: string; to?: string }> = [];
  orch.events = { publishAndEmit: vi.fn(async () => undefined) as never };
  orch.state = {
    transition: vi.fn(async (input: { from?: string; to?: string }) => {
      transitions.push({ from: input.from, to: input.to });
      return input.to;
    }) as never,
  };
  orch.fireHooks = vi.fn().mockResolvedValue(undefined) as never;
  orch.checkpoints = {
    tryCreatePreExecution: vi.fn().mockResolvedValue(undefined),
    tryCreatePreStep: vi.fn().mockResolvedValue(undefined),
  };
  orch.verification = { verify: vi.fn().mockResolvedValue(opts.verifyResults) } as never;
  orch.runSecurityScan = vi.fn().mockResolvedValue({ findings: [] }) as never;
  orch.runReview = vi
    .fn()
    .mockResolvedValue({ blocking: [], non_blocking: [], confidence: "high" }) as never;
  orch.proposeNextAction = vi.fn().mockResolvedValue(null) as never;
  orch.replanAfterFailure = vi.fn().mockResolvedValue("FAILED") as never;

  const input = {
    taskId: "task-spec",
    runId: "run-spec",
    workspaceId: "ws-1",
    projectId: "proj-1",
    userId: "user-1",
    goal: "spec-driven coverage gate test",
    constraints: null,
    agentMode: "BUILD",
    selectedModelMode: "ROUTED",
    modelOverride: null,
    workspaceInstructionVersion: null,
    policySnapshotId: "snap-1",
  } as unknown as RunInput;

  const ctx = {
    task: { id: "task-spec" },
    workspace: { status: "ACTIVE", name: "ws" },
    project: { status: "AVAILABLE", connectionType: "CLOUD", rootReference: "/" },
    snapshot: { blockOnReviewFindings: false },
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
    orch.executionLoop(input, "run-spec", ctx, budget, Date.now() + 60_000);

  return { orch, transitions, run };
}

const documentedStep = {
  id: "s1",
  title: "Document the flag",
  detail: "",
  acceptanceCriteria: ["README documents --dry-run"],
};

describe("spec-driven flow: acceptance criteria coverage gate", () => {
  it("proceeds when every criterion is asserted by a passing command", async () => {
    const h = createSpecHarness({
      steps: [documentedStep],
      verificationPlan: [
        { command: "grep dry-run README.md", asserts: ["README documents --dry-run"] },
      ],
      verifyResults: [{ command: "grep dry-run README.md", status: "PASSED" }],
    });

    await expect(h.run()).resolves.toBe("COMPLETED");
    expect(h.orch.replanAfterFailure as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(h.transitions).toContainEqual({ from: "VERIFYING", to: "REVIEWING" });
    expect(h.transitions).toContainEqual({ from: "REVIEWING", to: "COMPLETED" });
  });

  it("replans with the uncovered criterion when no passing command asserts it", async () => {
    const h = createSpecHarness({
      steps: [documentedStep],
      verificationPlan: [{ command: "grep dry-run README.md", asserts: [] }],
      verifyResults: [{ command: "grep dry-run README.md", status: "PASSED" }],
    });

    await expect(h.run()).resolves.toBe("FAILED");
    const replan = h.orch.replanAfterFailure as ReturnType<typeof vi.fn>;
    expect(replan).toHaveBeenCalledTimes(1);
    const summary = replan.mock.calls[0]?.[4] as string;
    expect(summary).toContain("Acceptance criteria not asserted");
    expect(summary).toContain("README documents --dry-run");
    expect(h.transitions).not.toContainEqual({ from: "REVIEWING", to: "COMPLETED" });
  });

  it("failed commands still gate and both failure reasons are joined", async () => {
    const h = createSpecHarness({
      steps: [documentedStep],
      verificationPlan: [{ command: "npm test", asserts: [] }],
      verifyResults: [{ command: "npm test", status: "FAILED", output: "1 failing" }],
    });

    await expect(h.run()).resolves.toBe("FAILED");
    const replan = h.orch.replanAfterFailure as ReturnType<typeof vi.fn>;
    expect(replan).toHaveBeenCalledTimes(1);
    const summary = replan.mock.calls[0]?.[4] as string;
    expect(summary).toContain("Verification failed: npm test");
    expect(summary).toContain("Acceptance criteria not asserted");
    expect(summary).toContain(" | ");
  });

  it("legacy plans without criteria never trigger the coverage gate", async () => {
    const h = createSpecHarness({
      steps: [{ id: "s1", title: "step", detail: "", acceptanceCriteria: [] }],
      verificationPlan: [{ command: "npm test", asserts: [] }],
      verifyResults: [{ command: "npm test", status: "PASSED" }],
    });

    await expect(h.run()).resolves.toBe("COMPLETED");
    expect(h.orch.replanAfterFailure as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
