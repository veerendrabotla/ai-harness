import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTraceCollector } from "./collector.js";

describe("Agent Observability", () => {
  let collector: InMemoryTraceCollector;

  beforeEach(() => {
    collector = new InMemoryTraceCollector();
    collector.clearAll();
  });

  describe("Trace Lifecycle", () => {
    it("should create a trace with goal", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      const trace = collector.getTrace(traceId);
      expect(trace).not.toBeNull();
      expect(trace!.goal).toBe("Build a login page");
      expect(trace!.taskId).toBe("task-1");
      expect(trace!.runId).toBe("run-1");
    });

    it("should complete a trace with outcome", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.completeTrace(traceId, {
        status: "completed",
        summary: "Successfully built login page",
        filesChanged: ["src/Login.tsx", "src/Login.css"],
        testsRun: 5,
        testsPassed: 5,
        errorsEncountered: 0,
        selfFixesAttempted: 0,
      });
      const trace = collector.getTrace(traceId);
      expect(trace!.outcome.status).toBe("completed");
      expect(trace!.outcome.filesChanged).toHaveLength(2);
      expect(trace!.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Reasoning", () => {
    it("should record reasoning steps", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.addReasoning(traceId, {
        thought: "User needs a login page with email/password",
        context: ["Project uses React", "No existing auth"],
        confidence: 0.9,
        sources: ["package.json", "src/App.tsx"],
      });
      const trace = collector.getTrace(traceId);
      expect(trace!.reasoning).toHaveLength(1);
      expect(trace!.reasoning[0]!.thought).toContain("login page");
      expect(trace!.reasoning[0]!.confidence).toBe(0.9);
    });
  });

  describe("Plan", () => {
    it("should record plan steps", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.addPlanStep(traceId, {
        action: "Create Login component",
        rationale: "Core UI component needed",
        expectedOutcome: "Login.tsx with form",
        riskLevel: "low",
        dependencies: [],
        status: "completed",
      });
      collector.addPlanStep(traceId, {
        action: "Add form validation",
        rationale: "Security requirement",
        expectedOutcome: "Email/password validation",
        riskLevel: "medium",
        dependencies: [],
        status: "pending",
      });
      const trace = collector.getTrace(traceId);
      expect(trace!.plan).toHaveLength(2);
      expect(trace!.plan[0]!.status).toBe("completed");
      expect(trace!.plan[1]!.status).toBe("pending");
    });
  });

  describe("Tool Execution", () => {
    it("should record tool executions with reasoning", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.addToolExecution(traceId, {
        toolName: "write_file",
        input: { path: "src/Login.tsx", content: "..." },
        output: { success: true },
        status: "success",
        duration: 150,
        reasoning: "Creating the main Login component",
      });
      const trace = collector.getTrace(traceId);
      expect(trace!.executions).toHaveLength(1);
      expect(trace!.executions[0]!.toolName).toBe("write_file");
      expect(trace!.executions[0]!.reasoning).toBe("Creating the main Login component");
    });
  });

  describe("Observations", () => {
    it("should record observations with impact", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.addObservation(traceId, {
        type: "error_detected",
        content: "TypeScript error: Property 'email' does not exist",
        source: "typecheck",
        impact: "self_fix",
      });
      const trace = collector.getTrace(traceId);
      expect(trace!.observations).toHaveLength(1);
      expect(trace!.observations[0]!.impact).toBe("self_fix");
    });
  });

  describe("Decisions", () => {
    it("should record decisions with alternatives", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.addDecision(traceId, {
        type: "tool_selection",
        reasoning: "Using write_file instead of edit_file because this is a new file",
        alternatives: ["edit_file", "create_file"],
        confidence: 0.95,
        outcome: "write_file succeeded",
      });
      const trace = collector.getTrace(traceId);
      expect(trace!.decisions).toHaveLength(1);
      expect(trace!.decisions[0]!.alternatives).toHaveLength(2);
    });
  });

  describe("Evidence", () => {
    it("should record evidence", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.addEvidence(traceId, {
        type: "test_result",
        description: "All tests pass",
        artifact: "test-results.json",
        passed: true,
      });
      const trace = collector.getTrace(traceId);
      expect(trace!.evidence).toHaveLength(1);
      expect(trace!.evidence[0]!.passed).toBe(true);
    });
  });

  describe("Query", () => {
    it("should get traces by task", () => {
      collector.startTrace("task-1", "run-1", "Goal 1");
      collector.startTrace("task-1", "run-2", "Goal 1 continued");
      collector.startTrace("task-2", "run-3", "Goal 2");

      const traces = collector.getTracesByTask("task-1");
      expect(traces).toHaveLength(2);
    });

    it("should generate trace summary", () => {
      const traceId = collector.startTrace("task-1", "run-1", "Build a login page");
      collector.addReasoning(traceId, {
        thought: "User needs auth",
        context: [],
        confidence: 0.9,
        sources: [],
      });
      collector.addPlanStep(traceId, {
        action: "Create component",
        rationale: "Needed",
        expectedOutcome: "Component created",
        riskLevel: "low",
        dependencies: [],
        status: "completed",
      });
      collector.addToolExecution(traceId, {
        toolName: "write_file",
        input: {},
        output: null,
        status: "success",
        duration: 100,
        reasoning: "Creating file",
      });
      collector.completeTrace(traceId, {
        status: "completed",
        summary: "Done",
        filesChanged: [],
        testsRun: 0,
        testsPassed: 0,
        errorsEncountered: 0,
        selfFixesAttempted: 0,
      });

      const trace = collector.getTrace(traceId)!;
      const summary = collector.getTraceSummary(trace);
      expect(summary).toContain("Build a login page");
      expect(summary).toContain("Reasoning");
      expect(summary).toContain("Plan");
      expect(summary).toContain("Tool Calls");
    });
  });
});
