import type { PolicySnapshot, ToolRuleSnapshot } from "./types.js";

/**
 * Structural inputs so the permission engine stays independent of Prisma:
 * callers pass any object shaped like a workspace policy + its tool rules
 * (e.g. a Prisma include result satisfies this structurally).
 */
export interface PolicyLike {
  id: string;
  workspaceId: string;
  requirePlanApproval: boolean;
  allowDirectExecution: boolean;
  maxTaskDurationSeconds: number;
  maxToolCallsPerRun: number;
  maxSubagents: number;
  blockOnReviewFindings?: boolean;
}

export interface ToolRuleLike {
  id: string;
  toolName: string;
  actionPattern: string | null;
  riskLevel: ToolRuleSnapshot["riskLevel"];
  decision: ToolRuleSnapshot["decision"];
}

export function buildPolicySnapshot(
  policy: PolicyLike & { toolRules?: ToolRuleLike[] },
): PolicySnapshot {
  const rules: ToolRuleSnapshot[] = (policy.toolRules ?? []).map((r) => ({
    id: r.id,
    toolName: r.toolName,
    actionPattern: r.actionPattern,
    riskLevel: r.riskLevel,
    decision: r.decision,
  }));
  return {
    workspaceId: policy.workspaceId,
    policyId: policy.id,
    requirePlanApproval: policy.requirePlanApproval,
    allowDirectExecution: policy.allowDirectExecution,
    maxTaskDurationSeconds: policy.maxTaskDurationSeconds,
    maxToolCallsPerRun: policy.maxToolCallsPerRun,
    maxSubagents: policy.maxSubagents,
    blockOnReviewFindings: policy.blockOnReviewFindings ?? false,
    rules,
    capturedAt: new Date().toISOString(),
  };
}
