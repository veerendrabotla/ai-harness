import type { CircuitState, CircuitConfig, CircuitStats } from "./types.js";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;
  private config: CircuitConfig;

  constructor(config?: Partial<CircuitConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      recoveryTimeout: config?.recoveryTimeout ?? 30000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 3,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (this.shouldTryRecovery()) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccess = new Date();

    if (this.state === "half-open") {
      this.state = "closed";
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.failures >= this.config.failureThreshold) {
      this.state = "open";
    }
  }

  private shouldTryRecovery(): boolean {
    if (!this.lastFailure) return true;
    return Date.now() - this.lastFailure.getTime() >= this.config.recoveryTimeout;
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
    };
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = undefined;
    this.lastSuccess = undefined;
  }
}
