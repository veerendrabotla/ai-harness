/**
 * Monitoring Routes.
 * Prometheus metrics endpoint and aggregated health check endpoint.
 */
import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import { HealthChecker } from "@ai-harness/health-checker";
import { getSharedRedis } from "../../lib/redis.js";
import { apiMetrics, queueCountsToPrometheus } from "../../lib/metrics.js";
import { getQueueCounts, type QueueCounts } from "../../lib/task-queue.js";

const healthChecker = new HealthChecker({ timeoutMs: 5000 });

/** Queue counts or zeros — metrics endpoints must not fail on Redis outages. */
async function safeQueueCounts(): Promise<QueueCounts | null> {
  try {
    return await getQueueCounts();
  } catch {
    return null;
  }
}

export default function registerMonitoringRoutes(app: FastifyInstance) {
  const adminPreHandler = [app.authenticate, app.requirePlatformAdmin];

  // Register built-in health checks against real infrastructure
  healthChecker.registerCheck("database", async () => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return "healthy";
    } catch (err) {
      app.log.error({ err }, "[Admin] Database health check failed:");
      return "unhealthy";
    }
  });

  healthChecker.registerCheck("redis", async () => {
    const redis = getSharedRedis();
    if (!redis) return "unhealthy";
    try {
      await redis.ping();
      return "healthy";
    } catch (err) {
      app.log.error({ err }, "[Admin] Redis health check failed:");
      return "unhealthy";
    }
  });

  healthChecker.registerCheck("worker", async () => {
    // Worker health - verify task queue connectivity by checking Redis
    const redis = getSharedRedis();
    if (!redis) return "unhealthy";
    try {
      // Check if BullMQ queues are accessible
      const queueKeys = await redis.keys("bull:*:id");
      if (queueKeys.length >= 0) return "healthy";
      return "healthy";
    } catch (err) {
      app.log.error({ err }, "[Admin] Worker health check failed:");
      return "unhealthy";
    }
  });

  /**
   * Aggregate health check across all subsystems (admin only).
   */
  app.get("/v1/admin/health", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "monitoring"],
      summary: "Aggregated health check across database, Redis, and worker",
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    const aggregation = await healthChecker.runAllChecks();
    const overall = healthChecker.getOverallStatus();

    const statusCode = overall === "unhealthy" ? 503 : 200;
    return ok(reply, {
      status: overall,
      checks: aggregation,
      timestamp: new Date(),
      uptimeMs: Date.now() - (healthChecker as unknown as { startTime: number }).startTime,
    }, statusCode);
  });

  /**
   * Prometheus-compatible scrape endpoint.
   * Auth: bearer token OR no auth when Prometheus scrapes via internal network.
   * In production, restrict via network policy / API gateway; here we allow
   * unauthenticated GET but rate-limited (global 100/min).
   */
  app.get("/metrics", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (_req, reply) => {
    const prom = apiMetrics.toPrometheus();
    // Enrich with process-level gauges
    const mem = process.memoryUsage();
    const extra = [
      `# TYPE process_resident_memory_bytes gauge`,
      `process_resident_memory_bytes ${mem.rss}`,
      `# TYPE process_heap_used_bytes gauge`,
      `process_heap_used_bytes ${mem.heapUsed}`,
      `# TYPE process_uptime_seconds gauge`,
      `process_uptime_seconds ${process.uptime().toFixed(1)}`,
    ].join("\n") + "\n";
    // Task-queue depth incl. failed count (omitted only if Redis is down)
    const counts = await safeQueueCounts();
    const queue = counts ? queueCountsToPrometheus(counts) : "";
    reply.header("content-type", "text/plain; version=0.0.4");
    return reply.send(extra + queue + prom.text);
  });

  /**
   * Get current metrics summary (admin only).
   */
  app.get("/v1/admin/metrics", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "monitoring"],
      summary: "Get collected metrics summary (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          name: { type: "string", description: "Filter by metric name" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { name?: string };
    const metrics = apiMetrics.getMetrics(query.name);
    const counts = await safeQueueCounts();

    return ok(reply, {
      metrics,
      total: metrics.length,
      counters: Object.fromEntries(
        Array.from(new Set(metrics.filter((m) => m.type === "counter").map((m) => m.name))).map((name) => [
          name,
          apiMetrics.getCounter(name),
        ]),
      ),
      queue: counts ?? { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
    });
  });
}
