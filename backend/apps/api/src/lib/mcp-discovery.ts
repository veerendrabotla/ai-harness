import { createHash } from "node:crypto";
import { BridgeGatewayClient, decryptSecret, getEnv } from "@ai-harness/shared";
import { getSharedRedis } from "./redis.js";

/**
 * MCP tool discovery (F-13) with a short-lived cache.
 * Discovery costs a bridge round-trip (STDIO) or an upstream JSON-RPC call
 * (HTTP/SSE), so results are cached per server for DISCOVERY_TTL_SECONDS,
 * keyed by the decrypted config: any config change produces a different hash
 * and misses the cache naturally. Failures are never cached.
 */

export const DISCOVERY_TTL_SECONDS = 600;

export interface DiscoveredTool {
  name: string;
  description?: string;
}

export interface DiscoveryCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface DiscoveryLogger {
  error(obj: object, msg: string): void;
}

export interface DiscoveryServer {
  id: string;
  transportType: string;
  encryptedConfig: Uint8Array;
}

export interface DiscoverMcpToolsDeps {
  cache?: DiscoveryCache | null;
  log: DiscoveryLogger;
  /** STDIO: resolve the owner's connected bridge id (null when offline). */
  findBridgeId?: () => Promise<string | null>;
  /** STDIO: run one JSON-RPC tools/list on the bridge. */
  callBridgeStdio?: (
    bridgeId: string,
    command: string,
    args: string[],
    rpc: { jsonrpc: string; id: number; method: string; params: Record<string, unknown> },
  ) => Promise<unknown>;
  fetchImpl?: typeof fetch;
}

export function discoveryCacheKey(serverId: string): string {
  return `mcp:discovery:${serverId}`;
}

export function configHash(plaintextConfig: string): string {
  return createHash("sha256").update(plaintextConfig).digest("hex");
}

export function redisDiscoveryCache(): DiscoveryCache | null {
  const redis = getSharedRedis();
  if (!redis) return null;
  return {
    async get(key) {
      return await redis.get(key).catch(() => null);
    },
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, "EX", ttlSeconds).catch(() => undefined);
    },
    async del(key) {
      await redis.del(key).catch(() => undefined);
    },
  };
}

const LIST_RPC = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
} as const;

function parseTools(payload: unknown): DiscoveredTool[] | null {
  const tools = (
    payload as { tools?: unknown } | undefined
  )?.tools;
  if (!Array.isArray(tools)) return null;
  const valid = tools.filter(
    (t): t is DiscoveredTool =>
      !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string",
  );
  return valid.slice(0, 200);
}

/**
 * Discover tools for a server, serving from cache when the config hash still
 * matches. Returns null when discovery failed (nothing is cached).
 */
export async function discoverMcpTools(
  server: DiscoveryServer,
  deps: DiscoverMcpToolsDeps,
): Promise<DiscoveredTool[] | null> {
  const env = getEnv();
  let plaintext: string;
  try {
    plaintext = decryptSecret(Buffer.from(server.encryptedConfig), env.ENCRYPTION_KEY);
  } catch (err) {
    deps.log.error({ err, serverId: server.id }, "[MCP] Discovery config decrypt failed:");
    return null;
  }
  const hash = configHash(plaintext);
  const key = discoveryCacheKey(server.id);

  if (deps.cache) {
    try {
      const raw = await deps.cache.get(key);
      if (raw) {
        const cached = JSON.parse(raw) as { hash?: string; tools?: DiscoveredTool[] };
        if (cached.hash === hash && Array.isArray(cached.tools)) return cached.tools;
      }
    } catch {
      // Cache read/parse failures fall through to a live discovery.
    }
  }

  let tools: DiscoveredTool[] | null = null;
  try {
    const config = JSON.parse(plaintext) as {
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
    };
    if (server.transportType === "STDIO") {
      if (config.command && deps.findBridgeId && deps.callBridgeStdio) {
        const bridgeId = await deps.findBridgeId();
        if (bridgeId) {
          const data = await deps.callBridgeStdio(
            bridgeId,
            config.command,
            config.args ?? [],
            LIST_RPC as unknown as { jsonrpc: string; id: number; method: string; params: Record<string, unknown> },
          );
          const content = (data as { content?: unknown } | undefined)?.content;
          tools = parseTools(content);
        }
      }
    } else if (config.url) {
      const res = await (deps.fetchImpl ?? fetch)(config.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(config.headers ?? {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/list", params: {} }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json()) as { result?: unknown };
      tools = parseTools(json.result);
    }
  } catch (err) {
    deps.log.error({ err, serverId: server.id }, "[MCP] Tool discovery failed:");
    return null;
  }

  if (tools && deps.cache) {
    await deps.cache
      .set(key, JSON.stringify({ hash, tools }), DISCOVERY_TTL_SECONDS)
      .catch(() => undefined);
  }
  return tools;
}

/** Drop cached discovery for a server (config changed or server deleted). */
export async function invalidateDiscoveryCache(
  serverId: string,
  cache?: DiscoveryCache | null,
): Promise<void> {
  const target = cache ?? redisDiscoveryCache();
  if (!target) return;
  await target.del(discoveryCacheKey(serverId)).catch(() => undefined);
}

/** Wire the real bridge transport for STDIO discovery. */
export function bridgeStdioDeps(): Pick<DiscoverMcpToolsDeps, "callBridgeStdio"> {
  return {
    async callBridgeStdio(bridgeId, command, args, rpc) {
      const env = getEnv();
      const gw = new BridgeGatewayClient({
        baseUrl: env.BRIDGE_GATEWAY_URL,
        internalToken: env.BRIDGE_INTERNAL_TOKEN,
      });
      const res = await gw.execute(bridgeId, "mcp.stdio", { command, args, rpc }, 20_000);
      if (!res.ok) throw new Error(res.error?.message ?? "stdio discovery failed");
      return res.data;
    },
  };
}
