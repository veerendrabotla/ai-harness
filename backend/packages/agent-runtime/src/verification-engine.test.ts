import { describe, expect, it, vi } from "vitest";
import { VerificationEngine } from "./verification-engine.js";

function createEngine(overrides?: { execute?: ReturnType<typeof vi.fn> }) {
  const prisma = { verificationResult: { create: vi.fn().mockResolvedValue({}) } };
  const events = { publishAndEmit: vi.fn().mockResolvedValue(undefined) };
  const harness = {
    execute: overrides?.execute ?? vi.fn().mockResolvedValue({ status: "SUCCEEDED", output: "ok" }),
  };
  const engine = new VerificationEngine(prisma as never, events as never, harness as never);
  return { engine, prisma, events, harness };
}

const base = { taskId: "t1", runId: "r1" };

describe("VerificationEngine.verify", () => {
  it("maps SUCCEEDED to PASSED and persists a result record", async () => {
    const { engine, prisma, harness } = createEngine();
    const results = await engine.verify({ ...base, commands: [{ command: "npm test" }] });
    expect(results).toEqual([{ command: "npm test", status: "PASSED", output: "ok" }]);
    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(prisma.verificationResult.create).toHaveBeenCalledTimes(1);
    const data = (prisma.verificationResult.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    expect(data.status).toBe("PASSED");
  });

  it("maps a failed harness result to FAILED with its failure message", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "FAILED", failureMessage: "boom" });
    const { engine } = createEngine({ execute });
    const results = await engine.verify({ ...base, commands: [{ command: "npm test" }] });
    expect(results[0]?.status).toBe("FAILED");
    expect(results[0]?.output).toBe("boom");
  });

  it("maps a thrown harness error to ERROR", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("harness exploded"));
    const { engine } = createEngine({ execute });
    const results = await engine.verify({ ...base, commands: [{ command: "npm test" }] });
    expect(results[0]?.status).toBe("ERROR");
    expect(results[0]?.output).toBe("harness exploded");
  });

  it("skips browser commands when no browser engine is wired", async () => {
    const { engine, harness } = createEngine();
    const results = await engine.verify({
      ...base,
      commands: [{ command: "browser: https://example.test should show \"Hi\"" }],
    });
    expect(results[0]?.status).toBe("SKIPPED");
    expect(results[0]?.output).toContain("no browser engine");
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it("returns [] with a note payload when no commands are configured", async () => {
    const { engine, events } = createEngine();
    const results = await engine.verify({ ...base, commands: [] });
    expect(results).toEqual([]);
    const completion = (events.publishAndEmit as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0]?.eventType === "VERIFICATION_COMPLETED",
    );
    expect(completion?.[0].payload.note).toContain("No verification commands configured.");
  });

  it("publishes VERIFICATION_COMPLETED with allPassed=false on failure", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "FAILED", failureMessage: "nope" });
    const { engine, events } = createEngine({ execute });
    await engine.verify({ ...base, commands: [{ command: "npm test" }] });
    const completion = (events.publishAndEmit as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0]?.eventType === "VERIFICATION_COMPLETED",
    );
    expect(completion?.[0].payload.allPassed).toBe(false);
    expect(completion?.[0].payload.results).toEqual([{ command: "npm test", status: "FAILED" }]);
  });
});

describe("VerificationEngine.uncoveredCriteria", () => {
  const criteria = ["README documents the flag", "unit test covers parse()"];
  const steps = [{ acceptanceCriteria: criteria }];

  it("returns [] when every criterion is asserted by a passing command", () => {
    const uncovered = VerificationEngine.uncoveredCriteria({
      steps,
      verificationPlan: [
        { command: "grep flag README.md", asserts: ["README documents the flag"] },
        { command: "npm test", asserts: ["unit test covers parse()"] },
      ],
      results: [
        { command: "grep flag README.md", status: "PASSED" },
        { command: "npm test", status: "PASSED" },
      ],
    });
    expect(uncovered).toEqual([]);
  });

  it("returns criteria that no command claims to prove", () => {
    const uncovered = VerificationEngine.uncoveredCriteria({
      steps,
      verificationPlan: [{ command: "grep flag README.md", asserts: ["README documents the flag"] }],
      results: [{ command: "grep flag README.md", status: "PASSED" }],
    });
    expect(uncovered).toEqual(["unit test covers parse()"]);
  });

  it("ignores asserts from commands that did not pass", () => {
    const uncovered = VerificationEngine.uncoveredCriteria({
      steps,
      verificationPlan: [
        { command: "npm test", asserts: ["README documents the flag", "unit test covers parse()"] },
      ],
      results: [{ command: "npm test", status: "FAILED" }],
    });
    expect(uncovered).toEqual(criteria);
  });

  it("returns [] for legacy steps without criteria", () => {
    expect(
      VerificationEngine.uncoveredCriteria({
        steps: [{ acceptanceCriteria: [] }, {}],
        verificationPlan: [{ command: "npm test", asserts: [] }],
        results: [{ command: "npm test", status: "PASSED" }],
      }),
    ).toEqual([]);
  });

  it("returns [] when the plan declares no verificationPlan (auto-inferred commands assert nothing)", () => {
    expect(
      VerificationEngine.uncoveredCriteria({
        steps,
        verificationPlan: [],
        results: [{ command: "npm test", status: "PASSED" }],
      }),
    ).toEqual([]);
  });

  it("normalizes whitespace and case when matching criteria to asserts", () => {
    expect(
      VerificationEngine.uncoveredCriteria({
        steps: [{ acceptanceCriteria: ["  README   documents the FLAG "] }],
        verificationPlan: [
          { command: "grep flag README.md", asserts: ["readme documents the flag"] },
        ],
        results: [{ command: "grep flag README.md", status: "PASSED" }],
      }),
    ).toEqual([]);
  });

  it("deduplicates identical criteria and skips empty strings", () => {
    const uncovered = VerificationEngine.uncoveredCriteria({
      steps: [
        { acceptanceCriteria: ["same criterion", "same criterion", ""] },
        { acceptanceCriteria: ["same criterion"] },
      ],
      verificationPlan: [{ command: "npm test", asserts: [] }],
      results: [{ command: "npm test", status: "PASSED" }],
    });
    expect(uncovered).toEqual(["same criterion"]);
  });
});

describe("VerificationEngine.inferVerificationCommands", () => {
  it("emits typecheck, lint, test, build in priority order", () => {
    const commands = VerificationEngine.inferVerificationCommands({
      scripts: [
        { name: "build", command: "tsc -b", purpose: "build" },
        { name: "test", command: "vitest run", purpose: "test" },
        { name: "lint", command: "eslint .", purpose: "lint" },
        { name: "typecheck", command: "tsc --noEmit", purpose: "typecheck" },
      ],
      testSetup: { hasTests: true },
    });
    expect(commands.map((c) => c.command)).toEqual([
      "npm run typecheck",
      "npm run lint",
      "npm run test",
      "npm run build",
    ]);
  });

  it("falls back to tsc when no typecheck script exists but tsconfig does", () => {
    const commands = VerificationEngine.inferVerificationCommands({
      conventions: { tsConfig: true },
    });
    expect(commands.map((c) => c.command)).toEqual(["npx tsc --noEmit"]);
  });

  it("omits the test command when the project has no tests", () => {
    const commands = VerificationEngine.inferVerificationCommands({
      scripts: [{ name: "test", command: "vitest run", purpose: "test" }],
      testSetup: { hasTests: false },
    });
    expect(commands).toEqual([]);
  });

  it("returns [] when nothing is detected", () => {
    expect(VerificationEngine.inferVerificationCommands({})).toEqual([]);
  });
});
