/** Failure codes recorded on task_runs.failure_code. */

export const FAILURE_CODES = {
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PLAN_VALIDATION_FAILED: "PLAN_VALIDATION_FAILED",
  PLAN_REJECTED: "PLAN_REJECTED",
  POLICY_DENIED: "POLICY_DENIED",
  TOOL_TIMEOUT: "TOOL_TIMEOUT",
  EXECUTION_ENVIRONMENT_UNAVAILABLE: "EXECUTION_ENVIRONMENT_UNAVAILABLE",
  MAX_REPLANS_EXCEEDED: "MAX_REPLANS_EXCEEDED",
  MAX_TOOL_CALLS_EXCEEDED: "MAX_TOOL_CALLS_EXCEEDED",
  MAX_DURATION_EXCEEDED: "MAX_DURATION_EXCEEDED",
  CONTEXT_BUILD_FAILED: "CONTEXT_BUILD_FAILED",
  REVIEW_BLOCKED: "REVIEW_BLOCKED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

/** Tool failure classification (AGENT_RUNTIME.md §16). */
export type ToolFailureClass =
  | "retryable"
  | "non_retryable"
  | "permission_related"
  | "environment_related"
  | "cancelled";

export function classifyToolFailure(status: string, code?: string): ToolFailureClass {
  switch (status) {
    case "TIMED_OUT":
      return "retryable";
    case "DENIED":
      return "permission_related";
    case "CANCELLED":
      return "cancelled";
    default:
      break;
  }
  if (code === "BRIDGE_DISCONNECTED" || code === "EXECUTION_ENVIRONMENT_UNAVAILABLE") {
    return "environment_related";
  }
  if (code === "TOOL_TIMEOUT") return "retryable";
  if (code === "POLICY_DENIED") return "permission_related";
  return "non_retryable";
}
