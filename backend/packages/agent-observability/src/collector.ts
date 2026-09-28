/**
 * Trace Collector.
 * In-memory trace builder that captures the full execution story.
 * Stores traces in memory for fast access, persists to DB asynchronously.
 */
import { randomUUID } from "node:crypto";
import type {
  ExecutionTrace,
  ReasoningStep,
  PlanStep,
  ToolExecution,
  Observation,
  Decision,
  Evidence,
  VerificationResult,
  TraceOutcome,
  TraceBuilder,
} from "./types.js";

const traces = new Map<string, ExecutionTrace>();

export class InMemoryTraceCollector implements TraceBuilder {
  startTrace(taskId: string, runId: string, goal: string): string {
    const id = randomUUID();
    const now = new Date();

    traces.set(id, {
      id,
      taskId,
      runId,
      goal,
      reasoning: [],
      plan: [],
      executions: [],
      observations: [],
      decisions: [],
      evidence: [],
      verification: [],
      outcome: {
        status: "completed",
        summary: "",
        filesChanged: [],
        testsRun: 0,
        testsPassed: 0,
        errorsEncountered: 0,
        selfFixesAttempted: 0,
      },
      duration: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0, estimatedCost: 0 },
      createdAt: now,
      completedAt: now,
    });

    return id;
  }

  addReasoning(traceId: string, step: Omit<ReasoningStep, "id" | "timestamp">): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.reasoning.push({ ...step, id: randomUUID(), timestamp: new Date() });
  }

  addPlanStep(traceId: string, step: Omit<PlanStep, "id" | "timestamp">): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.plan.push({ ...step, id: randomUUID(), timestamp: new Date() });
  }

  addToolExecution(traceId: string, execution: Omit<ToolExecution, "id" | "timestamp">): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.executions.push({ ...execution, id: randomUUID(), timestamp: new Date() });
  }

  addObservation(traceId: string, observation: Omit<Observation, "id" | "timestamp">): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.observations.push({ ...observation, id: randomUUID(), timestamp: new Date() });
  }

  addDecision(traceId: string, decision: Omit<Decision, "id" | "timestamp">): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.decisions.push({ ...decision, id: randomUUID(), timestamp: new Date() });
  }

  addEvidence(traceId: string, evidence: Omit<Evidence, "id" | "timestamp">): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.evidence.push({ ...evidence, id: randomUUID(), timestamp: new Date() });
  }

  addVerification(traceId: string, verification: Omit<VerificationResult, "id" | "timestamp">): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.verification.push({ ...verification, id: randomUUID(), timestamp: new Date() });
  }

  completeTrace(traceId: string, outcome: TraceOutcome): void {
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.outcome = outcome;
    trace.completedAt = new Date();
    trace.duration = trace.completedAt.getTime() - trace.createdAt.getTime();
  }

  getTrace(traceId: string): ExecutionTrace | null {
    return traces.get(traceId) ?? null;
  }

  getTracesByTask(taskId: string): ExecutionTrace[] {
    return Array.from(traces.values())
      .filter((t) => t.taskId === taskId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Get a summary of a trace for display.
   */
  getTraceSummary(trace: ExecutionTrace): string {
    const lines: string[] = [];
    lines.push(`Goal: ${trace.goal}`);
    lines.push(`Duration: ${(trace.duration / 1000).toFixed(1)}s`);
    lines.push(`Outcome: ${trace.outcome.status}`);

    if (trace.reasoning.length > 0) {
      lines.push(`\nReasoning (${trace.reasoning.length} steps):`);
      for (const r of trace.reasoning.slice(0, 3)) {
        lines.push(`  - ${r.thought}`);
      }
    }

    if (trace.plan.length > 0) {
      lines.push(`\nPlan (${trace.plan.length} steps):`);
      for (const p of trace.plan.slice(0, 5)) {
        lines.push(`  - [${p.status}] ${p.action}`);
      }
    }

    if (trace.executions.length > 0) {
      lines.push(`\nTool Calls (${trace.executions.length}):`);
      for (const e of trace.executions.slice(0, 5)) {
        lines.push(`  - ${e.toolName}: ${e.status} (${e.duration}ms)`);
      }
    }

    if (trace.decisions.length > 0) {
      lines.push(`\nDecisions (${trace.decisions.length}):`);
      for (const d of trace.decisions.slice(0, 3)) {
        lines.push(`  - ${d.type}: ${d.reasoning}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Clear all traces (for testing).
   */
  clearAll(): void {
    traces.clear();
  }
}
