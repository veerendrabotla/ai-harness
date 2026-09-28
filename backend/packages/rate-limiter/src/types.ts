export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (identifier: string) => string;
  /** When true, key is prefixed with "user:" for per-user tracking. */
  perUser?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export interface RateLimitStats {
  totalRequests: number;
  blockedRequests: number;
  activeKeys: number;
}

export type JobPriority = "high" | "medium" | "low";
