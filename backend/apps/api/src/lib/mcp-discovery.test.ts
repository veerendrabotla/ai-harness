import { describe, it, expect, beforeEach } from "vitest";
import { ensureEnvLoaded, encryptSecret, getEnv } from "@ai-harness/shared";
import {
  DISCOVERY_TTL_SECONDS,
  configHash,
  discoverMcpTools,
  discoveryCacheKey,
  invalidateDiscoveryCache,
  type DiscoveryCache,
  type DiscoverMcpToolsDeps,
  type DiscoveryServer,
} from "./mcp-discovery.js";

ensureEnvLoaded();

function memoryCache(): DiscoveryCache & { store: Map<string, string>; sets: number } {
  const store = new Map<string, string>();
  return {
    store,
    sets: 0,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      this.sets++;
      store.set(key, value);
    },
    async del(key) {
      store.delete(key);
    },
  };
}

function makeServer(transportType: string, config: Record<string, unknown>): DiscoveryServer {
  const encrypted = encryptSecret(JSON.stringify(config), getEnv().ENCRYPTION_KEY);
  return {
    id: `srv-${Math.random().toString(36).slice(2)}`,
    transportType,
    encryptedConfig: Buffer.from(encrypted),
  };
}

const log = { error: () => undefined };

describe("MCP tool discovery caching", () => {
  let cache: ReturnType<typeof memoryCache>;
  let fetchCalls: { url: string; body: string }[];

  const fetchImpl = (async (url: unknown, init?: { body?: string }) => {
    fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
    return {
      json: async () => ({ result: { tools: [{ name: "alpha", description: "a" }, { name: "beta" }] } }),
    } as unknown as Response;
  }) as typeof fetch;

  const httpDeps = (): DiscoverMcpToolsDeps => ({ cache, log, fetchImpl });

  beforeEach(() => {
    cache = memoryCache();
    fetchCalls = [];
  });

  it("caches HTTP discovery and serves the second call without refetching", async () => {
    const server = makeServer("HTTP", { url: "http://mcp.example/rpc" });
    const first = await discoverMcpTools(server, httpDeps());
    const second = await discoverMcpTools(server, httpDeps());

    expect(first).toEqual([
      { name: "alpha", description: "a" },
      { name: "beta" },
    ]);
    expect(second).toEqual(first);
    expect(fetchCalls).toHaveLength(1);
    expect(cache.sets).toBe(1);
  });

  it("misses the cache when the config changes", async () => {
    const server = makeServer("HTTP", { url: "http://mcp.example/rpc" });
    await discoverMcpTools(server, httpDeps());

    const reconfigured: DiscoveryServer = {
      ...server,
      encryptedConfig: Buffer.from(encryptSecret(JSON.stringify({ url: "http://mcp.example/v2" }), getEnv().ENCRYPTION_KEY)),
    };
    await discoverMcpTools(reconfigured, httpDeps());
    expect(fetchCalls).toHaveLength(2);
  });

  it("does not cache failures", async () => {
    const failing: DiscoverMcpToolsDeps = {
      cache,
      log,
      fetchImpl: (async () => {
        throw new Error("upstream down");
      }) as typeof fetch,
    };
    const server = makeServer("HTTP", { url: "http://mcp.example/rpc" });
    expect(await discoverMcpTools(server, failing)).toBeNull();

    const healthy = await discoverMcpTools(server, httpDeps());
    expect(healthy).not.toBeNull();
    expect(fetchCalls).toHaveLength(1);
  });

  it("returns null and caches nothing when no bridge is connected (STDIO)", async () => {
    const server = makeServer("STDIO", { command: "npx", args: ["-y", "mcp-server"] });
    const deps: DiscoverMcpToolsDeps = {
      cache,
      log,
      findBridgeId: async () => null,
      callBridgeStdio: async () => ({ content: { tools: [{ name: "x" }] } }),
    };
    expect(await discoverMcpTools(server, deps)).toBeNull();
    expect(cache.sets).toBe(0);
  });

  it("caches STDIO bridge discovery across enable cycles", async () => {
    const server = makeServer("STDIO", { command: "npx", args: ["-y", "mcp-server"] });
    let bridgeCalls = 0;
    const deps = (): DiscoverMcpToolsDeps => ({
      cache,
      log,
      findBridgeId: async () => "bridge-1",
      callBridgeStdio: async () => {
        bridgeCalls++;
        return { content: { tools: [{ name: "tool" }] } };
      },
    });

    expect(await discoverMcpTools(server, deps())).toEqual([{ name: "tool" }]);
    expect(await discoverMcpTools(server, deps())).toEqual([{ name: "tool" }]);
    expect(bridgeCalls).toBe(1);
  });

  it("caps discovery at 200 tools", async () => {
    const tools = Array.from({ length: 250 }, (_, i) => ({ name: `t${i}` }));
    const deps: DiscoverMcpToolsDeps = {
      cache,
      log,
      fetchImpl: (async () =>
        ({ json: async () => ({ result: { tools } }) }) as unknown as Response) as typeof fetch,
    };
    const server = makeServer("HTTP", { url: "http://mcp.example/rpc" });
    const result = await discoverMcpTools(server, deps);
    expect(result).toHaveLength(200);
  });

  it("invalidation drops the cached entry", async () => {
    const server = makeServer("HTTP", { url: "http://mcp.example/rpc" });
    await discoverMcpTools(server, httpDeps());
    expect(cache.store.has(discoveryCacheKey(server.id))).toBe(true);

    await invalidateDiscoveryCache(server.id, cache);
    expect(cache.store.has(discoveryCacheKey(server.id))).toBe(false);

    await discoverMcpTools(server, httpDeps());
    expect(fetchCalls).toHaveLength(2);
  });

  it("config hash is stable for identical plaintext", () => {
    expect(configHash('{"url":"http://x"}')).toBe(configHash('{"url":"http://x"}'));
    expect(configHash('{"url":"http://x"}')).not.toBe(configHash('{"url":"http://y"}'));
  });

  it("exposes a sane TTL", () => {
    expect(DISCOVERY_TTL_SECONDS).toBeGreaterThanOrEqual(60);
  });
});
