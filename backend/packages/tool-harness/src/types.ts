import type { z } from "zod";
import type { RiskLevel } from "@ai-harness/contracts";

export type ExecutionEnvironment = "LOCAL_BRIDGE" | "CLOUD_SANDBOX" | "INTERNAL";

export interface ToolDefinition {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  inputSchema: z.ZodTypeAny;
  resultSchema: z.ZodTypeAny;
  /** Mandatory per-run timeout (FR-007). */
  timeoutMs: number;
  /** Hard cap on returned output bytes. */
  outputLimitBytes: number;
  environment: ExecutionEnvironment;
}

export interface ToolExecutionRequest {
  toolCallId: string;
  taskId: string;
  runId: string;
  toolName: string;
  input: unknown;
  /** Overrides the definition's default environment (CLOUD projects run LOCAL_BRIDGE tools in the sandbox). */
  environment?: ExecutionEnvironment;
}

export type ToolExecutionStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "DENIED"
  | "CANCELLED";

export interface ToolExecutionResult {
  status: ToolExecutionStatus;
  output?: Record<string, unknown>;
  failureCode?: string;
  failureMessage?: string;
  classification?:
    | "retryable"
    | "non_retryable"
    | "permission_related"
    | "environment_related"
    | "cancelled";
  durationMs: number;
}

/** Resolves an executable for a given environment or explains why it cannot run yet. */
export interface ExecutionEnvironmentResolver {
  resolve(
    environment: ExecutionEnvironment,
    definition: ToolDefinition,
  ): Promise<(input: unknown, signal: AbortSignal, ctx?: { taskId?: string; runId?: string }) => Promise<unknown>>;
}
