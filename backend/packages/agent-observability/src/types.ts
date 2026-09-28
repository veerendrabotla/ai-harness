/**
 * Agent Observability Types.
 * Captures the full execution trace so developers can answer:
 * "Why did the AI do this?"
 *
 * Every trace captures:
 * - Goal: what the user asked
 * - Reasoning: what the agent understood
 * - Plan: what steps were chosen
 * - Execution: what tools were called
 * - Observation: what happened
 * - Decisions: why certain paths were taken
 * - Evidence: what was verified
 */

// ── Trace Structure ─────────────────────────────────────────

export interface ExecutionTrace {
  id: string;
  taskId: string;
  runId: string;
  goal: string;
  reasoning: ReasoningStep[];
  plan: PlanStep[];
  executions: ToolExecution[];
  observations: Observation[];
  decisions: Decision[];
  evidence: Evidence[];
  verification: VerificationResult[];
  outcome: TraceOutcome;
  duration: number;
  tokenUsage: TokenUsage;
  createdAt: Date;
  completedAt: Date;
}

export interface ReasoningStep {
  id: string;
  timestamp: Date;
  thought: string;
  context: string[];
  confidence: number; // 0-1
  sources: string[]; // what files/data informed this reasoning
}

export interface PlanStep {
  id: string;
  timestamp: Date;
  action: string;
  rationale: string;
  expectedOutcome: string;
  riskLevel: "low" | "medium" | "high";
  dependencies: string[]; // other step IDs
  status: "pending" | "in_progress" | "completed" | "skipped" | "failed";
}

export interface ToolExecution {
  id: string;
  timestamp: Date;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: "success" | "error" | "timeout" | "denied";
  duration: number;
  reasoning: string; // WHY this tool was chosen
  error?: string;
}

export interface Observation {
  id: string;
  timestamp: Date;
  type: "tool_result" | "error_detected" | "state_change" | "user_input";
  content: string;
  source: string; // where this observation came from
  impact: "none" | "replan" | "self_fix" | "escalate";
}

export interface Decision {
  id: string;
  timestamp: Date;
  type: "tool_selection" | "replan" | "self_fix" | "abort" | "escalate" | "skip_verification";
  reasoning: string;
  alternatives: string[]; // what else could have been done
  confidence: number;
  outcome: string; // what actually happened
}

export interface Evidence {
  id: string;
  timestamp: Date;
  type: "file_change" | "test_result" | "build_result" | "verification" | "user_confirmation";
  description: string;
  artifact?: string; // file path, test output, etc.
  passed: boolean;
}

export interface VerificationResult {
  id: string;
  timestamp: Date;
  command: string;
  status: "passed" | "failed" | "skipped" | "error";
  output: string;
}

export interface TraceOutcome {
  status: "completed" | "failed" | "cancelled" | "interrupted";
  summary: string;
  filesChanged: string[];
  testsRun: number;
  testsPassed: number;
  errorsEncountered: number;
  selfFixesAttempted: number;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  estimatedCost: number;
}

// ── Trace Builder ───────────────────────────────────────────

export interface TraceBuilder {
  startTrace(taskId: string, runId: string, goal: string): string;
  addReasoning(traceId: string, step: Omit<ReasoningStep, "id" | "timestamp">): void;
  addPlanStep(traceId: string, step: Omit<PlanStep, "id" | "timestamp">): void;
  addToolExecution(traceId: string, execution: Omit<ToolExecution, "id" | "timestamp">): void;
  addObservation(traceId: string, observation: Omit<Observation, "id" | "timestamp">): void;
  addDecision(traceId: string, decision: Omit<Decision, "id" | "timestamp">): void;
  addEvidence(traceId: string, evidence: Omit<Evidence, "id" | "timestamp">): void;
  addVerification(traceId: string, verification: Omit<VerificationResult, "id" | "timestamp">): void;
  completeTrace(traceId: string, outcome: Omit<TraceOutcome, "summary">): void;
  getTrace(traceId: string): ExecutionTrace | null;
  getTracesByTask(taskId: string): ExecutionTrace[];
}
