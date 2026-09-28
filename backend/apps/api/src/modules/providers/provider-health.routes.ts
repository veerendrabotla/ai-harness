/**
 * Provider Health Routes.
 * Persist provider health check history to DB via raw queries.
 */
import type { FastifyInstance } from "fastify";
import { ModelAdapterRegistry } from "@ai-harness/model-adapters";
import { errors } from "@ai-harness/shared";
import { ok, reqParam } from "../../lib/http.js";
import { randomUUID } from "node:crypto";
import { buildProviderRef } from "./provider-refs.js";

const adapters = new ModelAdapterRegistry();

interface HealthCheckRecord {
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
}

interface HealthRow {
  id: string;
  provider_connection_id: string;
  ok: boolean;
  latency_ms: number;
  checked_at: Date;
}

const MAX_HISTORY = 10;

async function storeCheck(
  prisma: FastifyInstance["prisma"],
  providerId: string,
  record: HealthCheckRecord,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO provider_health_checks (id, provider_connection_id, ok, latency_ms, checked_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
    randomUUID(), providerId, record.ok, record.latencyMs, new Date(record.checkedAt),
  );

  // Keep only last MAX_HISTORY per provider
  await prisma.$executeRawUnsafe(
    `DELETE FROM provider_health_checks
     WHERE provider_connection_id = $1::uuid
     AND id NOT IN (
       SELECT id FROM provider_health_checks
       WHERE provider_connection_id = $1::uuid
       ORDER BY checked_at DESC
       LIMIT $2
     )`,
    providerId, MAX_HISTORY,
  );
}

async function getHistory(
  prisma: FastifyInstance["prisma"],
  providerId: string,
): Promise<HealthCheckRecord[]> {
  const rows = await prisma.$queryRawUnsafe<HealthRow[]>(
    `SELECT * FROM provider_health_checks
     WHERE provider_connection_id = $1
     ORDER BY checked_at DESC
     LIMIT $2`,
    providerId, MAX_HISTORY,
  );
  return rows.map((r) => ({
    ok: r.ok,
    latencyMs: r.latency_ms,
    checkedAt: r.checked_at.toISOString(),
  }));
}

function computeSummary(checks: HealthCheckRecord[]) {
  if (checks.length === 0) {
    return { avgLatencyMs: 0, uptimePercent: 0, lastCheckAt: null, totalChecks: 0 };
  }
  const totalLatency = checks.reduce((s, c) => s + c.latencyMs, 0);
  const okCount = checks.filter((c) => c.ok).length;
  return {
    avgLatencyMs: Math.round(totalLatency / checks.length),
    uptimePercent: Math.round((okCount / checks.length) * 100),
    lastCheckAt: checks[0]?.checkedAt ?? null,
    totalChecks: checks.length,
  };
}

export default function registerProviderHealthRoutes(app: FastifyInstance) {
  app.get("/v1/providers/health/summary", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "Get health summary for all providers",
    },
  }, async (req, reply) => {
    const connections = await app.prisma.providerConnection.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });

    const results = await Promise.all(
      connections.map(async (conn) => {
        const adapter = adapters.get(conn.providerType);
        if (!adapter) {
          const record: HealthCheckRecord = {
            ok: false,
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
          };
          await storeCheck(app.prisma, conn.id, record);
          const history = await getHistory(app.prisma, conn.id);
          return {
            id: conn.id,
            providerType: conn.providerType,
            displayName: conn.displayName,
            ...record,
            ...computeSummary(history),
          };
        }

        const start = Date.now();
        let result: { ok: boolean; latencyMs: number; detail: string };
        try {
          result = await adapter.healthCheck(buildProviderRef(conn));
        } catch (err) {
          req.log.error({ err }, "[Health] Provider health check failed:");
          result = { ok: false, latencyMs: Date.now() - start, detail: "Health check failed" };
        }
        const record: HealthCheckRecord = {
          ok: result.ok,
          latencyMs: result.latencyMs,
          checkedAt: new Date().toISOString(),
        };
        await storeCheck(app.prisma, conn.id, record);
        const history = await getHistory(app.prisma, conn.id);
        return {
          id: conn.id,
          providerType: conn.providerType,
          displayName: conn.displayName,
          ...record,
          detail: result.detail,
          ...computeSummary(history),
        };
      }),
    );

    return ok(reply, results);
  });

  app.get("/v1/providers/:providerId/health", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "Check provider health with latency",
      params: {
        type: "object",
        required: ["providerId"],
        properties: { providerId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const providerId = reqParam(req, "providerId");
    const connection = await app.prisma.providerConnection.findFirst({
      where: { id: providerId, userId: req.user!.sub },
    });
    if (!connection) throw errors.notFound("Provider connection");

    const adapter = adapters.get(connection.providerType);
    if (!adapter) {
      throw errors.providerUnavailable(`No adapter for ${connection.providerType}`);
    }

    const start = Date.now();
    let result: { ok: boolean; latencyMs: number; detail: string };
    try {
      result = await adapter.healthCheck(buildProviderRef(connection));
    } catch (err) {
      req.log.error({ err }, "[Health] Single provider health check failed:");
      result = { ok: false, latencyMs: Date.now() - start, detail: "Health check failed" };
    }

    const record: HealthCheckRecord = {
      ok: result.ok,
      latencyMs: result.latencyMs,
      checkedAt: new Date().toISOString(),
    };
    await storeCheck(app.prisma, providerId, record);
    const history = await getHistory(app.prisma, providerId);

    return ok(reply, {
      id: connection.id,
      providerType: connection.providerType,
      displayName: connection.displayName,
      ...record,
      detail: result.detail,
      history,
      ...computeSummary(history),
    });
  });
}
