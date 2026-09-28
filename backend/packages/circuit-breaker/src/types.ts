export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  halfOpenMaxAttempts: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastSuccess?: Date;
}
