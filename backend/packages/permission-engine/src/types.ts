import type { RiskLevel } from "@ai-harness/contracts";

export interface ToolRuleSnapshot {
  id: string;
  toolName: string;
  actionPattern: string | null;
  riskLevel: RiskLevel;
  decision: "ALLOW" | "ASK" | "DENY";
}

/**
 * Immutable policy snapshot persisted per run (AGENT_RUNTIME.md §3):
 * later policy edits never reinterpret historical execution.
 */
export interface PolicySnapshot {
  workspaceId: string;
  policyId: string;
  requirePlanApproval: boolean;
  allowDirectExecution: boolean;
  maxTaskDurationSeconds: number;
  maxToolCallsPerRun: number;
  maxSubagents: number;
  blockOnReviewFindings: boolean;
  rules: ToolRuleSnapshot[];
  capturedAt: string;
}

export type PermissionOutcome = "ALLOW" | "ASK" | "DENY";

export interface ActiveApprovals {
  /** Tool names with a live TASK-scope approval. */
  taskScopeToolNames: string[];
}

export interface PermissionRequest {
  toolName: string;
  riskLevel: RiskLevel;
  approvals?: ActiveApprovals | undefined;
  /** File path for filesystem tools — used for per-file deny rules (e.g. .env protection). */
  resourcePath?: string | undefined;
  /** Alias for resourcePath (tool input `path` field). */
  path?: string | undefined;
}

export interface PermissionDecisionResult {
  outcome: PermissionOutcome;
  reason: string;
  matchedRuleId: string | null;
}
