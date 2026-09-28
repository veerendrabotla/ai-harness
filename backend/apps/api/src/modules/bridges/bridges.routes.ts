import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { registerBridgeProjectRootRequestSchema } from "@ai-harness/contracts";
import { generateOpaqueToken, getEnv, errors, sha256Hex } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";
import { getSharedRedis } from "../../lib/redis.js";

/**
 * Local Bridge management plane (PRD F-12).
 * Pairing tokens are ephemeral (Redis, hashed, TTL) — the gRPC/WebSocket data
 * gateway itself arrives in the next phase; these endpoints implement the
 * registration, root registry and lifecycle that the gateway will consume.
 */
export default function registerBridgeRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);
  const env = getEnv();

  app.post("/v1/bridges/pairing-tokens", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["bridges"],
      summary: "Generate a pairing token for a new bridge",
    },
  }, async (req, reply) => {
    const raw = generateOpaqueToken(32);
    const redis = getSharedRedis();
    if (redis) {
      const ttlSec = Math.round(env.BRIDGE_PAIRING_TOKEN_TTL_MINUTES * 60);
      await redis.set(
        `ah:bridge-pairing:${sha256Hex(raw)}`,
        JSON.stringify({ userId: req.user!.sub }),
        "EX",
        ttlSec,
      );
    }
    return ok(reply, { pairingToken: raw, expiresInMinutes: env.BRIDGE_PAIRING_TOKEN_TTL_MINUTES }, 201);
  });

  /** Called by the bridge device itself — authenticated by pairing token, not JWT. */
  app.post("/v1/bridges/pair", {
    schema: {
      tags: ["bridges"],
      summary: "Pair a bridge device using a pairing token",
      body: {
        type: "object",
        required: ["pairingToken", "name", "version"],
        properties: {
          pairingToken: { type: "string" },
          name: { type: "string", minLength: 1, maxLength: 120 },
          version: { type: "string", minLength: 1, maxLength: 50 },
          capabilities: { type: "object" },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { pairingToken?: string; name?: string; version?: string; capabilities?: Record<string, unknown> };
    if (!body.pairingToken || !body.name || !body.version) {
      throw errors.validation("pairingToken, name and version are required");
    }
    const redis = getSharedRedis();
    let userId: string | undefined;
    if (redis) {
      const stored = await redis.get(`ah:bridge-pairing:${sha256Hex(body.pairingToken)}`);
      if (!stored) throw errors.unauthenticated("Pairing token is invalid or expired");
      await redis.del(`ah:bridge-pairing:${sha256Hex(body.pairingToken)}`);
      userId = (JSON.parse(stored) as { userId?: string }).userId;
    }
    if (!userId) throw errors.unauthenticated();

    const deviceToken = generateOpaqueToken(32);
    const bridge = await app.prisma.bridge.create({
      data: {
        id: randomUUID(),
        userId,
        name: body.name.slice(0, 120),
        version: body.version.slice(0, 50),
        status: "PENDING",
        deviceTokenHash: sha256Hex(deviceToken),
        capabilities: (body.capabilities ?? {}) as object,
      },
    });
    // Device credentials are exchanged by the gateway during its handshake phase.
    await audit.record({
      actorUserId: userId,
      action: "BRIDGE_PAIRED",
      entityType: "BRIDGE",
      entityId: bridge.id,
      metadata: { name: bridge.name, version: bridge.version },
    });
    return ok(reply, {
      bridgeId: bridge.id,
      status: bridge.status,
      deviceToken,
      note: "The bridge gateway (next phase) exchanges this device token for short-lived session credentials.",
    }, 201);
  });

  app.get("/v1/bridges", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["bridges"],
      summary: "List bridges owned by the user",
    },
  }, async (req, reply) => {
    const bridges = await app.prisma.bridge.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    return ok(reply, bridges.map(serializeBridge));
  });

  app.get("/v1/bridges/:bridgeId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["bridges"],
      summary: "Get bridge details",
      params: {
        type: "object",
        required: ["bridgeId"],
        properties: { bridgeId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const bridgeId = reqParam(req, "bridgeId");
    const bridge = await loadOwnedBridge(app, req, bridgeId);
    return ok(reply, serializeBridge(bridge));
  });

  app.patch("/v1/bridges/:bridgeId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["bridges"],
      summary: "Update bridge name",
      params: {
        type: "object",
        required: ["bridgeId"],
        properties: { bridgeId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const bridgeId = reqParam(req, "bridgeId");
    const bridge = await loadOwnedBridge(app, req, bridgeId);
    const body = req.body as { name?: string };
    if (!body.name) throw errors.validation("Nothing to update");
    const updated = await app.prisma.bridge.update({
      where: { id: bridge.id },
      data: { name: body.name.slice(0, 120) },
    });
    return ok(reply, serializeBridge(updated));
  });

  app.post("/v1/bridges/:bridgeId/revoke", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["bridges"],
      summary: "Revoke a bridge",
      params: {
        type: "object",
        required: ["bridgeId"],
        properties: { bridgeId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const bridgeId = reqParam(req, "bridgeId");
    const bridge = await loadOwnedBridge(app, req, bridgeId);
    await app.prisma.$transaction(async (tx) => {
      await tx.bridge.update({ where: { id: bridge.id }, data: { status: "REVOKED" } });
      await tx.project.updateMany({ where: { bridgeId: bridge.id }, data: { status: "UNAVAILABLE" } });
    });
    await audit.record({
      actorUserId: req.user!.sub,
      action: "BRIDGE_REVOKED",
      entityType: "BRIDGE",
      entityId: bridge.id,
    });
    return ok(reply, { success: true });
  });

  app.get("/v1/bridges/:bridgeId/project-roots", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["bridges"],
      summary: "List project roots for a bridge",
      params: {
        type: "object",
        required: ["bridgeId"],
        properties: { bridgeId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const bridgeId = reqParam(req, "bridgeId");
    const bridge = await loadOwnedBridge(app, req, bridgeId);
    const roots = await app.prisma.bridgeProjectRoot.findMany({
      where: { bridgeId: bridge.id },
      orderBy: { createdAt: "asc" },
    });
    return ok(
      reply,
      roots.map((r) => ({
        id: r.id,
        bridgeId: r.bridgeId,
        displayName: r.displayName,
        canonicalRootReference: r.canonicalRootReference,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  });

  app.post("/v1/bridges/:bridgeId/project-roots", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["bridges"],
      summary: "Register a project root on a bridge",
      params: {
        type: "object",
        required: ["bridgeId"],
        properties: { bridgeId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const bridgeId = reqParam(req, "bridgeId");
    const bridge = await loadOwnedBridge(app, req, bridgeId);
    const input = registerBridgeProjectRootRequestSchema.parse(req.body);
    const existing = await app.prisma.bridgeProjectRoot.findUnique({
      where: {
        bridgeId_canonicalRootReference: {
          bridgeId: bridge.id,
          canonicalRootReference: input.canonicalRootReference,
        },
      },
    });
    if (existing) throw errors.conflict("This root is already registered on the bridge");
    const root = await app.prisma.bridgeProjectRoot.create({
      data: {
        id: randomUUID(),
        bridgeId: bridge.id,
        displayName: input.displayName,
        canonicalRootReference: input.canonicalRootReference,
      },
    });
    return ok(
      reply,
      {
        id: root.id,
        bridgeId: root.bridgeId,
        displayName: root.displayName,
        canonicalRootReference: root.canonicalRootReference,
        createdAt: root.createdAt.toISOString(),
      },
      201,
    );
  });
}

async function loadOwnedBridge(
  app: FastifyInstance,
  req: Parameters<FastifyInstance["authenticate"]>[0],
  bridgeId: string,
) {
  const bridge = await app.prisma.bridge.findUnique({ where: { id: bridgeId } });
  if (!bridge) throw errors.notFound("Bridge");
  if (req.user!.sub !== bridge.userId) throw errors.forbidden();
  return bridge;
}

function serializeBridge(b: {
  id: string;
  userId: string;
  name: string;
  version: string;
  status: string;
  capabilities: unknown;
  lastSeenAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: b.id,
    userId: b.userId,
    name: b.name,
    version: b.version,
    status: b.status,
    capabilities: b.capabilities ?? null,
    lastSeenAt: b.lastSeenAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}
