import type { HealthCheck, HealthStatus, HealthConfig, HealthAggregation } from "./types.js";

export class HealthChecker {
  private checks = new Map<string, () => Promise<HealthStatus>>();
  private results = new Map<string, HealthCheck>();
  private config: HealthConfig;
  private startTime: number;

  constructor(config?: Partial<HealthConfig>) {
    this.config = {
      timeoutMs: config?.timeoutMs ?? 5000,
      intervalMs: config?.intervalMs ?? 30000,
    };
    this.startTime = Date.now();
  }

  registerCheck(name: string, checkFn: () => Promise<HealthStatus>): void {
    this.checks.set(name, checkFn);
  }

  unregisterCheck(name: string): boolean {
    return this.checks.delete(name);
  }

  async runCheck(name: string): Promise<HealthCheck> {
    const checkFn = this.checks.get(name);
    if (!checkFn) {
      return {
        name,
        status: "unhealthy",
        message: "Check not found",
        duration: 0,
        timestamp: new Date(),
      };
    }

    const startTime = Date.now();

    try {
      const status = await Promise.race([
        checkFn(),
        new Promise<HealthStatus>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), this.config.timeoutMs)
        ),
      ]);

      const result: HealthCheck = {
        name,
        status,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };

      this.results.set(name, result);
      return result;
    } catch (error) {
      const result: HealthCheck = {
        name,
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };

      this.results.set(name, result);
      return result;
    }
  }

  async runAllChecks(): Promise<HealthCheck[]> {
    const results = await Promise.all(
      Array.from(this.checks.keys()).map(async (name) => {
        return this.runCheck(name);
      })
    );
    return results;
  }

  getOverallStatus(): HealthStatus {
    const results = Array.from(this.results.values());

    if (results.length === 0) return "healthy";

    if (results.some((r) => r.status === "unhealthy")) return "unhealthy";
    if (results.some((r) => r.status === "degraded")) return "degraded";

    return "healthy";
  }

  getLastResults(): HealthCheck[] {
    return Array.from(this.results.values());
  }

  getAggregation(): HealthAggregation {
    return {
      status: this.getOverallStatus(),
      checks: this.getLastResults(),
      timestamp: new Date(),
      uptimeMs: Date.now() - this.startTime,
    };
  }
}
