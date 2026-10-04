import { describe, expect, it, vi } from "vitest";
import { Planner, RUNTIME_SYSTEM_INSTRUCTIONS, linkCriteriaToAsserts } from "./planner.js";
import type { ModelAdapter } from "@ai-harness/model-adapters";
import type { ModelRequest, ModelResponse } from "@ai-harness/model-adapters";

const route = {
  providerConnection: {
    id: "conn-1",
    providerType: "OPENAI_COMPATIBLE" as const,
    displayName: "fake",
    credential: "x",
    metadata: {},
  },
  modelIdentifier: "fake-model",
  routeId: null,
  usedFallback: false,
  reason: "test",
};

function okPlan(text: string): ModelResponse {
  return {
    text,
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: "stop",
    providerRequestId: null,
    modelIdentifier: "fake-model",
    providerType: "OPENAI_COMPATIBLE",
  };
}

const validPlanJson = JSON.stringify({
  analysis: "a",
  assumptions: [],
  affectedFiles: [],
  steps: [{ id: "s1", title: "step" }],
  risks: [],
  verificationPlan: [],
});

describe("planner", () => {
  it("returns a validated plan on first success and records invocation", async () => {
    const adapter = {
      generate: vi.fn(async () => okPlan(validPlanJson)),
      stream: vi.fn(),
      healthCheck: vi.fn(),
    } as unknown as ModelAdapter;

    const publish = vi.fn(async () => undefined);
    const planner = new Planner(vi.fn() as never);
    const plan = await planner.createPlan({
      taskId: "t1",
      runId: "r1",
      goal: "do the thing",
      constraints: null,
      workspaceInstructions: null,
      adapter,
      route,
      revisionInstruction: null,
      previousPlan: null,
      streamDeltas: true,
      onDelta: (d) => expect(typeof d).toBe("string"),
      publish: publish as never,
    });
    expect(plan.steps[0]?.title).toBe("step");
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    // MODEL_ROUTE_SELECTED + MODEL_INVOCATION_RECORDED
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("retries once on transient failure then succeeds", async () => {
    const err = Object.assign(new Error("boom"), { retryable: true, name: "AdapterError" });
    let calls = 0;
    const adapter = {
      generate: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw err;
        return okPlan(validPlanJson);
      }),
      stream: vi.fn(),
      healthCheck: vi.fn(),
    } as never;

    const planner = new Planner(vi.fn() as never);
    const plan = await planner.createPlan({
      taskId: "t1", runId: "r1", goal: "g", constraints: null,
      workspaceInstructions: null, adapter: adapter as never, route,
      revisionInstruction: null, previousPlan: null,
      publish: (async () => undefined) as never,
    });
    expect(plan.analysis).toBe("a");
    expect(calls).toBe(2);
  });

  it("throws PLAN_VALIDATION_FAILED after non-retryable failure", async () => {
    const adapter = {
      generate: vi.fn(async () => {
        throw Object.assign(new Error("auth"), { name: "AdapterError", retryable: false });
      }),
      stream: vi.fn(), healthCheck: vi.fn(),
    } as never;
    const planner = new Planner(vi.fn() as never);
    await expect(
      planner.createPlan({
        taskId: "t1", runId: "r1", goal: "g", constraints: null,
        workspaceInstructions: null, adapter, route,
        revisionInstruction: null, previousPlan: null,
        publish: (async () => undefined) as never,
      }),
    ).rejects.toThrow();
  });
  it("includes runtime safety instructions in every request", async () => {
    let seen: ModelRequest | undefined;
    const adapter = {
      generate: vi.fn(async (req: ModelRequest) => { seen = req; return okPlan(validPlanJson); }),
      stream: vi.fn(),
      healthCheck: vi.fn(),
    } as never;
    const planner = new Planner(vi.fn() as never);
    await planner.createPlan({
      taskId: "t1", runId: "r1", goal: "g", constraints: null,
      workspaceInstructions: null, adapter, route,
      revisionInstruction: null, previousPlan: null,
      publish: (async () => undefined) as never,
    });
    expect(seen?.systemInstructions).toBe(RUNTIME_SYSTEM_INSTRUCTIONS);
  });

  it("instructs the model to emit acceptance criteria and per-command asserts", async () => {
    let seen: ModelRequest | undefined;
    const adapter = {
      generate: vi.fn(async (req: ModelRequest) => { seen = req; return okPlan(validPlanJson); }),
      stream: vi.fn(),
      healthCheck: vi.fn(),
    } as never;
    const planner = new Planner(vi.fn() as never);
    await planner.createPlan({
      taskId: "t1", runId: "r1", goal: "g", constraints: null,
      workspaceInstructions: null, adapter, route,
      revisionInstruction: null, previousPlan: null,
      publish: (async () => undefined) as never,
    });
    expect(seen?.userObjective).toContain('"acceptanceCriteria": string[]');
    expect(seen?.userObjective).toContain('"asserts": string[]');
    expect(seen?.userObjective).toContain("every acceptanceCriteria must be asserted");
    expect(seen?.userObjective).toContain("force a replan");
  });

  it("parses steps with acceptance criteria and commands with asserts", async () => {
    const json = JSON.stringify({
      analysis: "a",
      steps: [
        { id: "s1", title: "step", acceptanceCriteria: ["README documents --dry-run"] },
      ],
      verificationPlan: [
        { command: "grep dry-run README.md", asserts: ["README documents --dry-run"] },
      ],
    });
    const adapter = {
      generate: vi.fn(async () => okPlan(json)),
      stream: vi.fn(),
      healthCheck: vi.fn(),
    } as never;
    const planner = new Planner(vi.fn() as never);
    const plan = await planner.createPlan({
      taskId: "t1", runId: "r1", goal: "g", constraints: null,
      workspaceInstructions: null, adapter, route,
      revisionInstruction: null, previousPlan: null,
      publish: (async () => undefined) as never,
    });
    expect(plan.steps[0]?.acceptanceCriteria).toEqual(["README documents --dry-run"]);
    expect(plan.verificationPlan[0]?.asserts).toEqual(["README documents --dry-run"]);
  });

  it("fills empty criteria for models that omit them (legacy behaviour preserved)", async () => {
    const adapter = {
      generate: vi.fn(async () => okPlan(validPlanJson)),
      stream: vi.fn(),
      healthCheck: vi.fn(),
    } as never;
    const planner = new Planner(vi.fn() as never);
    const plan = await planner.createPlan({
      taskId: "t1", runId: "r1", goal: "g", constraints: null,
      workspaceInstructions: null, adapter, route,
      revisionInstruction: null, previousPlan: null,
      publish: (async () => undefined) as never,
    });
    expect(plan.steps[0]?.acceptanceCriteria).toEqual([]);
    expect(plan.verificationPlan).toEqual([]);
  });

  it("repairs paraphrased asserts end-to-end (observed qwen-lowtemp output)", async () => {
    const json = JSON.stringify({
      analysis: "a",
      steps: [
        {
          id: "S1", title: "Write 'OK' to hello.txt",
          acceptanceCriteria: [
            "hello.txt contains exactly 'OK'",
            "The file size of hello.txt is 4 bytes (for 'OK' in ASCII)",
          ],
        },
      ],
      verificationPlan: [
        { command: "cat hello.txt | wc -c", asserts: ["The output is 4"] },
        { command: "cat hello.txt", asserts: ["The output is 'OK'"] },
      ],
    });
    const adapter = {
      generate: vi.fn(async () => okPlan(json)),
      stream: vi.fn(),
      healthCheck: vi.fn(),
    } as never;
    const planner = new Planner(vi.fn() as never);
    const plan = await planner.createPlan({
      taskId: "t1", runId: "r1", goal: "g", constraints: null,
      workspaceInstructions: null, adapter, route,
      revisionInstruction: null, previousPlan: null,
      publish: (async () => undefined) as never,
    });
    expect(plan.verificationPlan[0]?.asserts).toContain(
      "The file size of hello.txt is 4 bytes (for 'OK' in ASCII)",
    );
    expect(plan.verificationPlan[1]?.asserts).toContain(
      "hello.txt contains exactly 'OK'",
    );
    // paraphrased claims are preserved alongside the verbatim criteria
    expect(plan.verificationPlan[0]?.asserts).toContain("The output is 4");
  });
});

describe("linkCriteriaToAsserts", () => {
  const paraphrasedPlan = {
    steps: [
      {
        acceptanceCriteria: [
          "hello.txt contains exactly 'OK'",
          "The file size of hello.txt is 4 bytes (for 'OK' in ASCII)",
        ],
      },
    ],
    verificationPlan: [
      { command: "cat hello.txt | wc -c", asserts: ["The output is 4"] },
      { command: "cat hello.txt", asserts: ["The output is 'OK'"] },
    ],
  };

  it("links paraphrased asserts to the original criterion text", () => {
    const linked = linkCriteriaToAsserts(paraphrasedPlan);
    expect(linked.verificationPlan[1]?.asserts).toContain(
      "hello.txt contains exactly 'OK'",
    );
    expect(linked.verificationPlan[0]?.asserts).toContain(
      "The file size of hello.txt is 4 bytes (for 'OK' in ASCII)",
    );
  });

  it("is idempotent and leaves already-claimed criteria untouched", () => {
    const once = linkCriteriaToAsserts(paraphrasedPlan);
    const twice = linkCriteriaToAsserts(once);
    expect(twice).toEqual(once);
    expect(linkCriteriaToAsserts(paraphrasedPlan).verificationPlan[0]?.asserts).toHaveLength(2);
  });

  it("keeps genuinely unlinkable criteria uncovered so the gate still fires", () => {
    const linked = linkCriteriaToAsserts({
      steps: [{ acceptanceCriteria: ["coverage report includes fuzz corpus entry"] }],
      verificationPlan: [{ command: "npm test", asserts: [] }],
    });
    expect(linked.verificationPlan[0]?.asserts).toEqual([]);
  });

  it("leaves plans without a verificationPlan unchanged (legacy behaviour)", () => {
    const plan = {
      steps: [{ acceptanceCriteria: ["anything"] }],
      verificationPlan: [] as Array<{ command: string; asserts: string[] }>,
    };
    expect(linkCriteriaToAsserts(plan)).toBe(plan);
  });
});
