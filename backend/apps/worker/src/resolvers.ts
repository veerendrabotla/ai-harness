import type { PrismaClient } from "@prisma/client";
import {
  BridgeGatewayClient,
  decryptSecret,
  errors,
  getEnv,
  isSafeOutboundUrl,
  toolKindForToolName,
} from "@ai-harness/shared";
import type { ExecutionEnvironmentResolver } from "@ai-harness/tool-harness";
import type { MCPRegistry } from "@ai-harness/mcp-platform";
import type { MCPServerConfig } from "@ai-harness/mcp-platform";

/**
 * Execution environment resolution for the worker.
 * - LOCAL_BRIDGE tools execute through the gateway against the registered
 *   bridge that owns the requested root.
 * - INTERNAL covers policy-restricted outbound HTTP and the MCP proxy.
 * - CLOUD_SANDBOX is not provisioned yet and fails honestly.
 */
export function buildEnvironmentResolver(prisma: PrismaClient, mcpRegistry?: MCPRegistry): ExecutionEnvironmentResolver {
  const env = getEnv();
  const gateway = new BridgeGatewayClient({
    baseUrl: env.BRIDGE_GATEWAY_URL,
    internalToken: env.BRIDGE_INTERNAL_TOKEN,
  });

  async function resolveBridgeIdForRoot(root: string): Promise<string> {
    const bridgeRoot = await prisma.bridgeProjectRoot.findFirst({
      where: { canonicalRootReference: root },
      include: { bridge: { select: { id: true, status: true } } },
    });
    if (!bridgeRoot || bridgeRoot.bridge.status !== "CONNECTED") {
      throw errors.bridgeDisconnected("No connected bridge owns this project root");
    }
    return bridgeRoot.bridge.id;
  }

  async function callBridge(
    bridgeId: string,
    kind: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const response = await gateway.execute(bridgeId, kind, params, timeoutMs);
    if (!response.ok) {
      throw Object.assign(new Error(response.error?.message ?? "bridge execution failed"), {
        code: response.error?.code ?? "BRIDGE_DISCONNECTED",
      });
    }
    return response.data ?? {};
  }

  /** Shared by the harness resolver AND the CheckpointManager. */
  async function runBridgeTool(
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const kind = toolKindForToolName(toolName);
    if (!kind) throw Object.assign(new Error(`tool ${toolName} is not bridge-executable`), { code: "UNSUPPORTED" });
    const root = typeof input["root"] === "string" ? input["root"] : "";
    if (!root && kind !== "ckpt.rollback") {
      throw Object.assign(new Error("missing root reference"), { code: "VALIDATION_ERROR" });
    }
    const bridgeId = await resolveBridgeIdForRoot(root);
    return callBridge(bridgeId, kind, input, timeoutMs);
  }

  async function httpExecutor(input: unknown): Promise<Record<string, unknown>> {
    const params = input as { method: string; url: string; headers?: Record<string, string>; body?: string };
    const guard = isSafeOutboundUrl(params.url);
    if (!guard.allowed) {
      throw Object.assign(new Error(guard.reason ?? "URL denied"), { code: "POLICY_DENIED" });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(params.url, {
        method: params.method,
        headers: params.headers,
        body: params.body,
        signal: controller.signal,
        redirect: "manual",
      });
      const text = (await res.text()).slice(0, 100_000);
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text };
    } finally {
      clearTimeout(timer);
    }
  }

  function mcpExecutor(prisma_: PrismaClient, registry?: MCPRegistry) {
    return async (
      input: unknown,
      _signal?: AbortSignal,
    ): Promise<Record<string, unknown>> => {
      const params = input as { serverId: string; mcpToolName: string; args?: Record<string, unknown> };
      const server = await prisma_.mcpServer.findUnique({ where: { id: params.serverId } });
      if (!server) throw Object.assign(new Error("MCP server not found"), { code: "NOT_FOUND" });
      if (server.status !== "ACTIVE") {
        throw Object.assign(new Error("MCP server is disabled"), { code: "POLICY_DENIED" });
      }
      if (server.transportType === "STDIO") {
        throw Object.assign(new Error("STDIO MCP transport is not supported yet"), { code: "UNSUPPORTED" });
      }

      if (registry) {
        let state = registry.getServer(params.serverId);
        if (!state) {
          const env2 = getEnv();
          const config = JSON.parse(
            decryptSecret(Buffer.from(server.encryptedConfig), env2.ENCRYPTION_KEY),
          ) as { url?: string; headers?: Record<string, string> };
          if (!config.url) throw Object.assign(new Error("server config missing url"), { code: "VALIDATION_ERROR" });

          const serverConfig: MCPServerConfig = {
            id: server.id,
            name: server.name,
            transport: server.transportType === "SSE" ? "sse" : "streamable-http",
            url: config.url,
            apiKey: config.headers?.authorization?.replace(/^Bearer\s+/i, ""),
            enabled: true,
            createdAt: server.createdAt,
            updatedAt: server.updatedAt,
          };
          await registry.registerServer(serverConfig);
          state = registry.getServer(params.serverId);
        }

        if (state && state.status !== "connected") {
          await registry.connectServer(params.serverId);
        }

        const result = await registry.callTool(params.serverId, params.mcpToolName, params.args ?? {});
        return result as Record<string, unknown>;
      }

      const env2 = getEnv();
      const config = JSON.parse(
        decryptSecret(Buffer.from(server.encryptedConfig), env2.ENCRYPTION_KEY),
      ) as { url?: string; headers?: Record<string, string> };
      if (!config.url) throw Object.assign(new Error("server config missing url"), { code: "VALIDATION_ERROR" });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(config.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(config.headers ?? {}) },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: { name: params.mcpToolName, arguments: params.args ?? {} },
          }),
          signal: controller.signal,
        });
        const json = (await res.json()) as { result?: unknown; error?: { message: string } };
        if (json.error) throw new Error(json.error.message);
        return { content: json.result ?? null };
      } finally {
        clearTimeout(timer);
      }
    };
  }

  return {
    async resolve(environment, definition) {
      switch (environment) {
        case "LOCAL_BRIDGE":
          return async (input: unknown) =>
            runBridgeTool(
              definition.name,
              (input ?? {}) as Record<string, unknown>,
              definition.timeoutMs,
            );
        case "INTERNAL":
          if (definition.name === "http.request") return httpExecutor;
          if (definition.name === "mcp.call") {
            const inner = mcpExecutor(prisma, mcpRegistry);
            return async (input: unknown, _signal: AbortSignal) => inner(input, undefined as unknown as AbortSignal);
          }
          break;
        case "CLOUD_SANDBOX":
          throw errors.bridgeDisconnected("Cloud Sandbox is not provisioned yet");
      }
      throw errors.bridgeDisconnected(`No executor available for environment '${environment}'`);
    },
  };
}

export type { ExecutionEnvironmentResolver };
