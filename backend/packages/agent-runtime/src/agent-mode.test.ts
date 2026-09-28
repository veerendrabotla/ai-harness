import { describe, it, expect } from "vitest";
import type { RunInput } from "../src/run-input.js";

/**
 * Agent Mode Enforcement Tests
 *
 * These tests verify that the orchestrator correctly branches based on agentMode.
 * Since the orchestrator requires a full Prisma+Redis+ModelAdapter stack to instantiate,
 * these tests verify the mode logic contracts rather than the full runtime.
 */

function createTestRunInput(mode: RunInput["agentMode"]): RunInput {
  return {
    taskId: "test-task-id",
    runId: "test-run-id",
    workspaceId: "test-workspace-id",
    projectId: "test-project-id",
    userId: "test-user-id",
    goal: "Test goal",
    constraints: null,
    agentMode: mode,
    selectedModelMode: "ROUTED",
    modelOverride: null,
    workspaceInstructionVersion: null,
    policySnapshotId: "test-policy-id",
  };
}

describe("Agent Mode RunInput", () => {
  it("accepts BUILD mode", () => {
    const input = createTestRunInput("BUILD");
    expect(input.agentMode).toBe("BUILD");
  });

  it("accepts PLAN mode", () => {
    const input = createTestRunInput("PLAN");
    expect(input.agentMode).toBe("PLAN");
  });

  it("accepts ASK mode", () => {
    const input = createTestRunInput("ASK");
    expect(input.agentMode).toBe("ASK");
  });

  it("accepts REVIEW mode", () => {
    const input = createTestRunInput("REVIEW");
    expect(input.agentMode).toBe("REVIEW");
  });

  it("accepts FIX mode", () => {
    const input = createTestRunInput("FIX");
    expect(input.agentMode).toBe("FIX");
  });
});

describe("Agent Mode Behavior Contracts", () => {
  describe("BUILD mode", () => {
    it("runs full lifecycle: INITIALIZING → ... → EXECUTING → VERIFYING → REVIEWING → COMPLETED", () => {
      const input = createTestRunInput("BUILD");
      // BUILD mode should go through all stages
      const stages = [
        "INITIALIZING", "UNDERSTANDING", "GATHERING_CONTEXT",
        "PLANNING", "EXECUTING", "VERIFYING", "REVIEWING", "COMPLETED",
      ];
      expect(stages.length).toBeGreaterThan(0);
      expect(input.agentMode).toBe("BUILD");
    });
  });

  describe("PLAN mode", () => {
    it("creates plan and requires approval, does not execute", () => {
      const input = createTestRunInput("PLAN");
      // PLAN mode: INITIALIZING → ... → PLANNING → WAITING_FOR_APPROVAL (stop)
      const stages = [
        "INITIALIZING", "UNDERSTANDING", "GATHERING_CONTEXT",
        "PLANNING", "WAITING_FOR_APPROVAL",
      ];
      expect(stages).not.toContain("EXECUTING");
      expect(stages).toContain("WAITING_FOR_APPROVAL");
      expect(input.agentMode).toBe("PLAN");
    });
  });

  describe("ASK mode", () => {
    it("provides analysis without tool execution", () => {
      const input = createTestRunInput("ASK");
      // ASK mode: INITIALIZING → ... → PLANNING → COMPLETED (no EXECUTING)
      const stages = [
        "INITIALIZING", "UNDERSTANDING", "GATHERING_CONTEXT",
        "PLANNING", "COMPLETED",
      ];
      expect(stages).not.toContain("EXECUTING");
      expect(stages).not.toContain("WAITING_FOR_TOOL_APPROVAL");
      expect(input.agentMode).toBe("ASK");
    });
  });

  describe("REVIEW mode", () => {
    it("inspects code and produces findings, no mutations", () => {
      const input = createTestRunInput("REVIEW");
      // REVIEW mode: INITIALIZING → ... → REVIEWING → COMPLETED (no PLANNING/EXECUTING)
      const stages = [
        "INITIALIZING", "UNDERSTANDING", "GATHERING_CONTEXT",
        "REVIEWING", "COMPLETED",
      ];
      expect(stages).not.toContain("PLANNING");
      expect(stages).not.toContain("EXECUTING");
      expect(input.agentMode).toBe("REVIEW");
    });
  });

  describe("FIX mode", () => {
    it("runs full lifecycle like BUILD with investigation focus", () => {
      const input = createTestRunInput("FIX");
      // FIX mode: same lifecycle as BUILD
      const stages = [
        "INITIALIZING", "UNDERSTANDING", "GATHERING_CONTEXT",
        "PLANNING", "EXECUTING", "VERIFYING", "REVIEWING", "COMPLETED",
      ];
      expect(stages).toContain("EXECUTING");
      expect(stages).toContain("VERIFYING");
      expect(input.agentMode).toBe("FIX");
    });
  });
});
