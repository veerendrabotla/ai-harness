export type LoopPhase =
  | "goal"
  | "context"
  | "plan"
  | "plan_approval"
  | "tool_selection"
  | "permission_check"
  | "tool_execution"
  | "observation"
  | "reason_decide"
  | "next_action"
  | "verification"
  | "review"
  | "complete"
  | "error";

export type FailureType =
  | "TYPE_ERROR"
  | "LINT_ERROR"
  | "TEST_FAILURE"
  | "BUILD_FAILURE"
  | "RUNTIME_FAILURE"
  | "NETWORK_FAILURE"
  | "DEPENDENCY_FAILURE"
  | "PERMISSION_FAILURE"
  | "TOOL_FAILURE"
  | "TIMEOUT"
  | "MODEL_FAILURE"
  | "UNKNOWN";

export interface LoopConfig {
  maxIterations: number;
  maxTokenBudget: number;
  maxTimeBudgetMs: number;
  maxRetryBudget: number;
  stuckThresholdMs: number;
  completionDetectionEnabled: boolean;
}

export interface LoopState {
  phase: LoopPhase;
  iteration: number;
  tokensUsed: number;
  timeMs: number;
  retriesUsed: number;
  currentPlan?: string;
  pendingApprovals: string[];
  filesChanged: string[];
  commandsExecuted: string[];
  observations: Observation[];
  errors: LoopError[];
  stuckDetected: boolean;
  completionDetected: boolean;
  startTime: Date;
  lastActivityTime: Date;
}

export interface Observation {
  id: string;
  phase: LoopPhase;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface LoopError {
  id: string;
  type: FailureType;
  message: string;
  phase: LoopPhase;
  timestamp: Date;
  recoverable: boolean;
  retryCount: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  permissionRequired: boolean;
  timestamp: Date;
}

export interface ToolResult {
  callId: string;
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
}

export interface LoopResult {
  success: boolean;
  finalPhase: LoopPhase;
  iterations: number;
  tokensUsed: number;
  timeMs: number;
  filesChanged: string[];
  commandsExecuted: string[];
  observations: Observation[];
  errors: LoopError[];
  output: string;
}

export interface StuckDetection {
  isStuck: boolean;
  reason?: string;
  lastActivityMs: number;
  samePhaseCount: number;
}

export interface CompletionDetection {
  isComplete: boolean;
  reason?: string;
  confidence: number;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterations: 50,
  maxTokenBudget: 100_000,
  maxTimeBudgetMs: 30 * 60 * 1000,
  maxRetryBudget: 5,
  stuckThresholdMs: 5 * 60 * 1000,
  completionDetectionEnabled: true,
};

export const PHASE_ORDER: LoopPhase[] = [
  "goal",
  "context",
  "plan",
  "plan_approval",
  "tool_selection",
  "permission_check",
  "tool_execution",
  "observation",
  "reason_decide",
  "next_action",
  "verification",
  "review",
  "complete",
];
