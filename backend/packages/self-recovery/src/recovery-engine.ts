import { randomUUID } from "node:crypto";
import type {
  FailureType,
  RecoveryAction,
  RecoveryPolicy,
  RecoveryAttempt,
  RecoveryResult,
  RecoveryStrategy,
} from "./types.js";
import { DEFAULT_RECOVERY_POLICY } from "./types.js";

export class SelfRecoveryEngine {
  private policy: RecoveryPolicy;
  private strategy: RecoveryStrategy;
  private history: RecoveryAttempt[] = [];

  constructor(policy?: Partial<RecoveryPolicy>, strategy?: RecoveryStrategy) {
    this.policy = { ...DEFAULT_RECOVERY_POLICY, ...policy };
    this.strategy = strategy || new DefaultRecoveryStrategy(this.policy);
  }

  classify(error: unknown): FailureType {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    if (lower.includes("timeout") || lower.includes("timed out")) return "TIMEOUT";
    if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network")) return "NETWORK_FAILURE";
    if (lower.includes("permission") || lower.includes("access denied") || lower.includes("forbidden")) return "PERMISSION_FAILURE";
    if (lower.includes("typeerror") || lower.includes("cannot read")) return "TYPE_ERROR";
    if (lower.includes("lint") || lower.includes("eslint")) return "LINT_ERROR";
    if (lower.includes("test") && lower.includes("fail")) return "TEST_FAILURE";
    if (lower.includes("build") && lower.includes("fail")) return "BUILD_FAILURE";
    if (lower.includes("module") && lower.includes("not found")) return "DEPENDENCY_FAILURE";
    if (lower.includes("rate limit") || lower.includes("429")) return "MODEL_FAILURE";
    return "UNKNOWN";
  }

  async attemptRecovery(
    error: unknown,
    executeFn: () => Promise<unknown>
  ): Promise<RecoveryResult> {
    const failureType = this.classify(error);
    const attempts: RecoveryAttempt[] = [];
    let recovered = false;

    for (let i = 0; i < this.policy.maxRetries; i++) {
      if (!this.strategy.canRecover(failureType)) {
        break;
      }

      const action = this.strategy.getAction(failureType, i);
      const start = Date.now();

      try {
        if (action === "abort") break;
        if (action === "skip") { recovered = true; break; }

        const delay = Math.min(
          this.policy.backoffMs * Math.pow(2, i),
          this.policy.maxBackoffMs
        );
        await new Promise((r) => setTimeout(r, delay));

        await executeFn();
        const attempt: RecoveryAttempt = {
          id: randomUUID(),
          failureType,
          error: error instanceof Error ? error.message : String(error),
          action,
          timestamp: new Date(),
          success: true,
          durationMs: Date.now() - start,
        };
        attempts.push(attempt);
        this.history.push(attempt);
        recovered = true;
        break;
      } catch (err) {
        const attempt: RecoveryAttempt = {
          id: randomUUID(),
          failureType,
          error: err instanceof Error ? err.message : String(err),
          action,
          timestamp: new Date(),
          success: false,
          durationMs: Date.now() - start,
        };
        attempts.push(attempt);
        this.history.push(attempt);
      }
    }

    return {
      recovered,
      attempts,
      finalError: recovered ? undefined : (error instanceof Error ? error.message : String(error)),
    };
  }

  getHistory(): RecoveryAttempt[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

class DefaultRecoveryStrategy implements RecoveryStrategy {
  constructor(private policy: RecoveryPolicy) {}

  canRecover(error: FailureType): boolean {
    return this.policy.retryableFailures.includes(error);
  }

  getAction(error: FailureType, attemptNumber: number): RecoveryAction {
    if (attemptNumber >= this.policy.maxRetries - 1) return "abort";
    if (error === "NETWORK_FAILURE" || error === "TIMEOUT") return "retry";
    if (error === "TOOL_FAILURE") return "modify_and_retry";
    if (error === "MODEL_FAILURE") return "fallback";
    return "retry";
  }
}
