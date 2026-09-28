export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type BuiltInCheckName = "database" | "redis" | "worker" | "gateway";

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  message?: string;
  duration: number;
  timestamp: Date;
}

export interface HealthConfig {
  timeoutMs: number;
  intervalMs: number;
}

export interface HealthAggregation {
  status: HealthStatus;
  checks: HealthCheck[];
  timestamp: Date;
  uptimeMs: number;
}
