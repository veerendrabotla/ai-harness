import type { RateLimitConfig, RateLimitResult, RateLimitStats } from "./types.js";

interface RequestRecord {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private requests = new Map<string, RequestRecord>();
  private totalRequests = 0;
  private blockedRequests = 0;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      keyGenerator: config.keyGenerator,
    };
  }

  checkLimit(identifier: string): RateLimitResult {
    let key = this.config.keyGenerator
      ? this.config.keyGenerator(identifier)
      : identifier;
    if (this.config.perUser) {
      key = `user:${key}`;
    }

    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || now > record.resetTime) {
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });

      this.totalRequests++;

      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetMs: this.config.windowMs,
      };
    }

    this.totalRequests++;

    if (record.count >= this.config.maxRequests) {
      this.blockedRequests++;
      return {
        allowed: false,
        remaining: 0,
        resetMs: record.resetTime - now,
      };
    }

    record.count++;
    return {
      allowed: true,
      remaining: this.config.maxRequests - record.count,
      resetMs: record.resetTime - now,
    };
  }

  getStats(): RateLimitStats {
    return {
      totalRequests: this.totalRequests,
      blockedRequests: this.blockedRequests,
      activeKeys: this.requests.size,
    };
  }

  reset(): void {
    this.requests.clear();
    this.totalRequests = 0;
    this.blockedRequests = 0;
  }

  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}
