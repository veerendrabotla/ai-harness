export type FailureType =
  | "TYPE_ERROR" | "LINT_ERROR" | "TEST_FAILURE" | "BUILD_FAILURE"
  | "RUNTIME_FAILURE" | "NETWORK_FAILURE" | "DEPENDENCY_FAILURE"
  | "PERMISSION_FAILURE" | "TOOL_FAILURE" | "TIMEOUT"
  | "MODEL_FAILURE" | "UNKNOWN";

export type RecoveryAction = "retry" | "skip" | "fallback" | "abort" | "modify_and_retry";

export interface RecoveryPolicy {
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs: number;
  retryableFailures: FailureType[];
}

export interface RecoveryAttempt {
  id: string;
  failureType: FailureType;
  error: string;
  action: RecoveryAction;
  timestamp: Date;
  success: boolean;
  durationMs: number;
}

export interface RecoveryResult {
  recovered: boolean;
  attempts: RecoveryAttempt[];
  finalError?: string;
}

export interface RecoveryStrategy {
  canRecover(error: FailureType): boolean;
  getAction(error: FailureType, attemptNumber: number): RecoveryAction;
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  maxRetries: 3,
  backoffMs: 1000,
  maxBackoffMs: 30_000,
  retryableFailures: ["NETWORK_FAILURE", "TIMEOUT", "TOOL_FAILURE", "RUNTIME_FAILURE", "MODEL_FAILURE"],
};
