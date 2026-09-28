import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createMcpServerRequestSchema, updateMcpServerRequestSchema } from "@ai-harness/contracts";
import { encryptSecret, errors, getEnv, redactValue } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";
import {
  bridgeStdioDeps,
  discoverMcpTools,
  invalidateDiscoveryCache,
  redisDiscoveryCache,
} from "../../lib/mcp-discovery.js";

/**
 * MCP server registry (PRD F-13).
 * Configuration is encrypted at rest and never returned. Tool discovery and the
 * call proxy arrive with the MCP execution phase; enable/disable is enforced
 * already so disabled servers cannot receive calls once the proxy lands.
 */
export default function registerMcpRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);
  const env = getEnv();

  app.get("/v1/mcp/servers", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "List MCP servers owned by the user",
    },
  }, async (req, reply) => {
    const servers = await app.prisma.mcpServer.findMany({
      where: { ownerId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    return ok(reply, servers.map(serializeServer));
  });

  app.post("/v1/mcp/servers", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "Register a new MCP server",
      body: {
        type: "object",
        required: ["name", "transportType", "config"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          transportType: { type: "string", enum: ["HTTP", "SSE", "STDIO"] },
          config: { type: "object" },
        },
      },
    },
  }, async (req, reply) => {
    const input = createMcpServerRequestSchema.parse(req.body);
    if (input.transportType === "STDIO") {
      const cmd = input.config["command"];
      if (typeof cmd !== "string" || cmd.length === 0) {
        throw errors.validation("STDIO transport requires config.command");
      }
    }
    if (input.transportType !== "STDIO" && typeof input.config["url"] !== "string") {
      throw errors.validation(`${input.transportType} transport requires config.url`);
    }
    const server = await app.prisma.mcpServer.create({
      data: {
        id: randomUUID(),
        ownerId: req.user!.sub,
        name: input.name,
        transportType: input.transportType,
        encryptedConfig: Buffer.from(encryptSecret(JSON.stringify(input.config), env.ENCRYPTION_KEY)),
        status: "DISABLED", // explicit enablement required (F-13)
      },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      action: "MCP_SERVER_CREATED",
      entityType: "MCP_SERVER",
      entityId: server.id,
      metadata: { transportType: server.transportType },
    });
    return ok(reply, serializeServer(server), 201);
  });

  app.get("/v1/mcp/servers/:serverId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "Get MCP server details",
      params: {
        type: "object",
        required: ["serverId"],
        properties: { serverId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const serverId = reqParam(req, "serverId");
    const server = await loadOwned(app, req, serverId);
    return ok(reply, serializeServer(server));
  });

  app.patch("/v1/mcp/servers/:serverId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "Update MCP server configuration",
      params: {
        type: "object",
        required: ["serverId"],
        properties: { serverId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const serverId = reqParam(req, "serverId");
    const server = await loadOwned(app, req, serverId);
    const input = updateMcpServerRequestSchema.parse(req.body);
    const updated = await app.prisma.mcpServer.update({
      where: { id: server.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.status && server.status !== "ACTIVE" ? { status: input.status } : {}),
        ...(input.config
          ? {
              encryptedConfig: Buffer.from(
                encryptSecret(JSON.stringify(input.config), env.ENCRYPTION_KEY),
              ),
            }
          : {}),
      },
    });
    if (input.config) await invalidateDiscoveryCache(server.id, redisDiscoveryCache());
    return ok(reply, serializeServer(updated));
  });

  app.delete("/v1/mcp/servers/:serverId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "Delete an MCP server",
      params: {
        type: "object",
        required: ["serverId"],
        properties: { serverId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const serverId = reqParam(req, "serverId");
    const server = await loadOwned(app, req, serverId);
    const links = await app.prisma.workspaceMcpServer.count({
      where: { mcpServerId: server.id, enabled: true },
    });
    if (links > 0) throw errors.conflict("Disable this server in all workspaces before deleting it");
    await app.prisma.mcpServer.delete({ where: { id: server.id } });
    await invalidateDiscoveryCache(server.id, redisDiscoveryCache());
    return ok(reply, { success: true });
  });

  app.post("/v1/workspaces/:workspaceId/mcp/:serverId/enable", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "Enable an MCP server in a workspace",
      params: {
        type: "object",
        required: ["workspaceId", "serverId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          serverId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    return toggleMcp(app, audit, req, reply, true);
  });

  app.post("/v1/workspaces/:workspaceId/mcp/:serverId/disable", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "Disable an MCP server in a workspace",
      params: {
        type: "object",
        required: ["workspaceId", "serverId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          serverId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    return toggleMcp(app, audit, req, reply, false);
  });

  app.get("/v1/workspaces/:workspaceId/mcp", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["mcp"],
      summary: "List MCP servers linked to a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");
    const rows = await app.prisma.workspaceMcpServer.findMany({
      where: { workspaceId },
      include: { server: true },
    });
    return ok(
      reply,
      rows.map((r) => ({
        server: serializeServer(r.server),
        enabled: r.enabled,
        linkedAt: r.createdAt.toISOString(),
      })),
    );
  });
}

type AuthedRequest = Parameters<FastifyInstance["authenticate"]>[0];

async function toggleMcp(
  app: FastifyInstance,
  audit: ReturnType<typeof createAuditRepository>,
  req: AuthedRequest,
  reply: import("fastify").FastifyReply,
  enabled: boolean,
): Promise<import("fastify").FastifyReply> {
  const workspaceId = reqParam(req, "workspaceId");
  const serverId = reqParam(req, "serverId");
  await app.requireWorkspaceRole(req, workspaceId, "OWNER");
  const server = await app.prisma.mcpServer.findFirst({
    where: { id: serverId, ownerId: req.user!.sub },
  });
  if (!server) throw errors.notFound("MCP server");
  if (
    (await app.prisma.workspace.findUnique({ where: { id: workspaceId } }))?.status ===
      "ARCHIVED" &&
    enabled
  ) {
    throw errors.workspaceArchived();
  }
  await app.prisma.workspaceMcpServer.upsert({
    where: { workspaceId_mcpServerId: { workspaceId, mcpServerId: server.id } },
    create: { workspaceId, mcpServerId: server.id, enabled },
    update: { enabled },
  });
  // Server-level status reflects whether ANY workspace has it enabled.
  // Discovery is cached (config-hash keyed) so repeated enable/disable cycles
  // don't re-run the bridge round-trip or upstream JSON-RPC call.
  let discovered: Array<{ name: string; description?: string }> | null = null;
  if (enabled) {
    discovered = await discoverMcpTools(server, {
      cache: redisDiscoveryCache(),
      log: req.log,
      findBridgeId: async () => {
        const bridge = await app.prisma.bridge.findFirst({
          where: { userId: req.user!.sub, status: "CONNECTED" },
          select: { id: true },
        });
        return bridge?.id ?? null;
      },
      ...bridgeStdioDeps(),
    });
  }
  await app.prisma.mcpServer.update({
    where: { id: server.id },
    data: {
      status: enabled ? (discovered ? "ACTIVE" : server.transportType === "STDIO" ? "ACTIVE" : "ERROR") : "DISABLED",
      ...(discovered ? { discoveredTools: discovered } : {}),
    },
  });
  await audit.record({
    actorUserId: req.user!.sub,
    workspaceId,
    action: enabled ? "MCP_SERVER_ENABLED" : "MCP_SERVER_DISABLED",
    entityType: "MCP_SERVER",
    entityId: server.id,
    metadata: redactValue({ name: server.name }) as Record<string, unknown>,
  });
  return ok(reply, { workspaceId, serverId: server.id, enabled });
}

async function loadOwned(
  app: FastifyInstance,
  req: Parameters<FastifyInstance["authenticate"]>[0],
  serverId: string,
) {
  const server = await app.prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) throw errors.notFound("MCP server");
  if (server.ownerId !== req.user!.sub) throw errors.forbidden();
  return server;
}

function serializeServer(s: {
  id: string;
  ownerId: string;
  name: string;
  transportType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    ownerId: s.ownerId,
    name: s.name,
    transportType: s.transportType,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    // encryptedConfig is never returned.
  };
}
