import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  createProviderRequestSchema,
  createProviderRequestSchemaWithTest,
  updateProviderRequestSchema,
  upsertModelRoutesRequestSchema,
} from "@ai-harness/contracts";
import type { ProviderType } from "@ai-harness/contracts";
import { encryptSecret, errors, getEnv } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ModelAdapterRegistry } from "@ai-harness/model-adapters";
import { ok, reqParam } from "../../lib/http.js";
import { buildProviderRef } from "./provider-refs.js";

const adapters = new ModelAdapterRegistry();

export default function registerProviderRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  // ── Provider connections (user-owned, encrypted at rest) ──

  app.get("/v1/providers", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "List provider connections for the authenticated user",
    },
  }, async (req, reply) => {
    const rows = await app.prisma.providerConnection.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      reply,
      rows.map((r) => serializeProvider(r)),
    );
  });

  app.post("/v1/providers", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "Create a new provider connection with credential",
      body: {
        type: "object",
        required: ["providerType", "displayName"],
        properties: {
          providerType: { type: "string" },
          displayName: { type: "string", minLength: 1, maxLength: 255 },
          credential: { type: "string", minLength: 8, maxLength: 4096 },
          metadata: { type: "object" },
        },
      },
    },
  }, async (req, reply) => {
    const env = getEnv();
    // TEST (simulated adapter) is allowed outside production so e2e/integration
    // runs can provision it; production always rejects it.
    const input = (env.NODE_ENV === "production"
      ? createProviderRequestSchema
      : createProviderRequestSchemaWithTest
    ).parse(req.body);
    const connection = await app.prisma.providerConnection.create({
      data: {
        id: randomUUID(),
        userId: req.user!.sub,
        providerType: input.providerType,
        displayName: input.displayName,
        encryptedCredential: input.credential
          ? Buffer.from(encryptSecret(input.credential, env.ENCRYPTION_KEY))
          : null,
        encryptedMetadata: input.metadata
          ? Buffer.from(encryptSecret(JSON.stringify(input.metadata), env.ENCRYPTION_KEY))
          : null,
        status: "ACTIVE",
      },
    });

    // Immediate connection test (APP_FLOW §11): failure flips the row to ERROR
    // but never returns the credential.
    const adapter = adapters.get(input.providerType);
    if (!adapter) {
      await app.prisma.providerConnection.update({
        where: { id: connection.id },
        data: { status: "ERROR" },
      });
      throw errors.providerUnavailable(`No adapter for ${input.providerType} in this build`);
    }
    const ref = {
      id: connection.id,
      providerType: input.providerType as ProviderType,
      displayName: connection.displayName,
      credential: input.credential ?? "",
      metadata: input.metadata ?? {},
    };
    const health = await adapter.healthCheck(ref);
    const status = health.ok ? "ACTIVE" : "ERROR";
    await app.prisma.providerConnection.update({
      where: { id: connection.id },
      data: { status },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      action: "PROVIDER_CREATED",
      entityType: "PROVIDER_CONNECTION",
      entityId: connection.id,
      metadata: { providerType: input.providerType, testOk: health.ok },
    });

    return ok(
      reply,
      { ...serializeProvider({ ...connection, status }), test: health },
      health.ok ? 201 : 201,
    );
  });
  app.post("/v1/providers/:providerConnectionId/test", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "Test a provider connection health",
      params: {
        type: "object",
        required: ["providerConnectionId"],
        properties: { providerConnectionId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const providerConnectionId = reqParam(req, "providerConnectionId");
    const connection = await app.prisma.providerConnection.findFirst({
      where: { id: providerConnectionId, userId: req.user!.sub },
    });
    if (!connection) throw errors.notFound("Provider connection");
    const adapter = adapters.get(connection.providerType);
    if (!adapter) throw errors.providerUnavailable(`No adapter for ${connection.providerType}`);

    const health = await adapter.healthCheck(buildProviderRef(connection));
    await app.prisma.providerConnection.update({
      where: { id: connection.id },
      data: { status: health.ok ? "ACTIVE" : "ERROR" },
    });
    return ok(reply, health satisfies { ok: boolean; detail: string; latencyMs: number });
  });
  app.patch("/v1/providers/:providerConnectionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "Update a provider connection",
      params: {
        type: "object",
        required: ["providerConnectionId"],
        properties: { providerConnectionId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const providerConnectionId = reqParam(req, "providerConnectionId");
    const existing = await app.prisma.providerConnection.findFirst({
      where: { id: providerConnectionId, userId: req.user!.sub },
    });
    if (!existing) throw errors.notFound("Provider connection");
    const input = updateProviderRequestSchema.parse(req.body);
    const env = getEnv();

    let statusUpdate: "ACTIVE" | "DISABLED" | undefined;
    if (input.status === "DISABLED") statusUpdate = "DISABLED";
    if (input.status === "ACTIVE") statusUpdate = "ACTIVE";

    const updated = await app.prisma.providerConnection.update({
      where: { id: providerConnectionId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(statusUpdate ? { status: statusUpdate } : {}),
        ...(input.credential
          ? { encryptedCredential: Buffer.from(encryptSecret(input.credential, env.ENCRYPTION_KEY)) }
          : {}),
      },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      action: "PROVIDER_UPDATED",
      entityType: "PROVIDER_CONNECTION",
      entityId: providerConnectionId,
      metadata: { fields: Object.keys(input).filter((f) => f !== "credential") },
    });
    return ok(reply, serializeProvider(updated));
  });
  app.delete("/v1/providers/:providerConnectionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "Delete a provider connection",
      params: {
        type: "object",
        required: ["providerConnectionId"],
        properties: { providerConnectionId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const providerConnectionId = reqParam(req, "providerConnectionId");
    const existing = await app.prisma.providerConnection.findFirst({
      where: { id: providerConnectionId, userId: req.user!.sub },
    });
    if (!existing) throw errors.notFound("Provider connection");
    const activeRoutes = await app.prisma.modelRoute.count({
      where: { providerConnectionId, active: true },
    });
    if (activeRoutes > 0) {
      throw errors.conflict("This connection is referenced by active model routes");
    }
    await app.prisma.workspaceProviderConnection.deleteMany({
      where: { providerConnectionId },
    });
    await app.prisma.providerConnection.delete({ where: { id: providerConnectionId } });
    await audit.record({
      actorUserId: req.user!.sub,
      action: "PROVIDER_DELETED",
      entityType: "PROVIDER_CONNECTION",
      entityId: providerConnectionId,
    });
    return ok(reply, { success: true });
  });

  // ── Model routes ─────────────────────────────────────────
  app.get("/v1/workspaces/:workspaceId/model-routes", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "List model routes for a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");
    const routes = await app.prisma.modelRoute.findMany({
      where: { workspaceId },
      orderBy: [{ stage: "asc" }, { priority: "asc" }],
    });
    return ok(reply, routes.map(serializeRoute));
  });

  /** PUT replaces the workspace route table. Connections are explicitly linked to the workspace on use. */
  app.put("/v1/workspaces/:workspaceId/model-routes", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["providers"],
      summary: "Replace all model routes for a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const input = upsertModelRoutesRequestSchema.parse(req.body);

    const ids = new Set(input.routes.map((r) => r.id ?? ""));
    for (const r of input.routes) {
      if (r.fallbackRouteId && !ids.has(r.fallbackRouteId)) {
        throw errors.validation("fallbackRouteId must reference a route in the same payload");
      }
    }

    const created = await app.prisma.$transaction(async (tx) => {
      await tx.modelRoute.deleteMany({ where: { workspaceId } });
      const out = [];
      for (const r of input.routes) {
        const link = await tx.workspaceProviderConnection.findUnique({
          where: {
            workspaceId_providerConnectionId: {
              workspaceId,
              providerConnectionId: r.providerConnectionId,
            },
          },
        });
        if (!link) {
          await tx.workspaceProviderConnection.create({
            data: { workspaceId, providerConnectionId: r.providerConnectionId },
          });
        }
        const conn = await tx.providerConnection.findUniqueOrThrow({
          where: { id: r.providerConnectionId },
          select: { userId: true },
        });
        if (conn.userId !== req.user!.sub) {
          throw errors.forbidden("Model routes may only reference your own provider connections");
        }
        const row = await tx.modelRoute.create({
          data: {
            id: randomUUID(),
            workspaceId,
            stage: r.stage,
            providerConnectionId: r.providerConnectionId,
            modelIdentifier: r.modelIdentifier,
            fallbackRouteId: r.fallbackRouteId ?? null,
            priority: r.priority,
            active: r.active,
          },
        });
        out.push(row);
      }
      return out;
    });

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "MODEL_ROUTES_UPDATED",
      entityType: "WORKSPACE_MODEL_ROUTES",
      entityId: workspaceId,
      metadata: { count: created.length },
    });
    return ok(reply, created.map(serializeRoute));
  });
}

function serializeProvider(p: {
  id: string;
  providerType: string;
  displayName: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  encryptedCredential: Uint8Array | Buffer | null;
}) {
  return {
    id: p.id,
    providerType: p.providerType,
    displayName: p.displayName,
    status: p.status,
    hasCredential: Boolean(p.encryptedCredential),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    // Credential bytes are NEVER returned (PRD F-07).
  };
}

function serializeRoute(r: {
  id: string;
  workspaceId: string;
  stage: string;
  providerConnectionId: string;
  modelIdentifier: string;
  fallbackRouteId: string | null;
  priority: number;
  active: boolean;
}) {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    stage: r.stage,
    providerConnectionId: r.providerConnectionId,
    modelIdentifier: r.modelIdentifier,
    fallbackRouteId: r.fallbackRouteId,
    priority: r.priority,
    active: r.active,
  };
}
