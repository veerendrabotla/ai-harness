import { describe, it, expect, beforeEach } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MCPRegistry } from "./registry.js";
import { MCPConnectionManager } from "./connection-manager.js";
import type { MCPServerConfig } from "./types.js";

function createTestConfig(id: string, overrides?: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    id,
    name: `Test Server ${id}`,
    description: "A test MCP server",
    transport: "stdio",
    command: "test-server",
    args: ["--port", "3000"],
    enabled: true,
    workspaceId: "workspace-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

type RpcHandler = (method: string, params: Record<string, unknown>) => Record<string, unknown>;

function startMockMcpServer(handler: RpcHandler): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const rpc = JSON.parse(body) as { id: unknown; method: string; params?: Record<string, unknown> };
        const result = handler(rpc.method, rpc.params ?? {});
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { message: String(err) } }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("MCPRegistry", () => {
  let registry: MCPRegistry;

  beforeEach(() => {
    registry = new MCPRegistry();
  });

  describe("Server Registration", () => {
    it("should register a server", async () => {
      const config = createTestConfig("server-1");
      const state = await registry.registerServer(config);

      expect(state.id).toBe("server-1");
      expect(state.status).toBe("disconnected");
      expect(state.config.name).toBe("Test Server server-1");
    });

    it("should unregister a server", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);

      await registry.unregisterServer("server-1");
      expect(registry.getServer("server-1")).toBeUndefined();
    });

    it("should list all servers", async () => {
      await registry.registerServer(createTestConfig("server-1"));
      await registry.registerServer(createTestConfig("server-2"));

      const servers = registry.listServers();
      expect(servers.length).toBe(2);
    });

    it("should list servers by workspace", async () => {
      await registry.registerServer(createTestConfig("server-1", { workspaceId: "ws-1" }));
      await registry.registerServer(createTestConfig("server-2", { workspaceId: "ws-2" }));
      await registry.registerServer(createTestConfig("server-3", { workspaceId: "ws-1" }));

      const servers = registry.listServersByWorkspace("ws-1");
      expect(servers.length).toBe(2);
    });

    it("should list servers by project", async () => {
      await registry.registerServer(createTestConfig("server-1", { projectId: "proj-1" }));
      await registry.registerServer(createTestConfig("server-2", { projectId: "proj-2" }));

      const servers = registry.listServersByProject("proj-1");
      expect(servers.length).toBe(1);
    });
  });

  describe("Connection Lifecycle", () => {
    it("should connect to a server", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);

      const connection = await registry.connectServer("server-1");
      expect(connection.status).toBe("connected");
      expect(connection.serverId).toBe("server-1");

      const state = registry.getServer("server-1");
      expect(state?.status).toBe("connected");
      expect(state?.connectedAt).toBeDefined();
    });

    it("should disconnect from a server", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      await registry.disconnectServer("server-1");
      const state = registry.getServer("server-1");
      expect(state?.status).toBe("disconnected");
    });

    it("should reconnect to a server", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      const connection = await registry.reconnectServer("server-1");
      expect(connection.status).toBe("connected");

      const state = registry.getServer("server-1");
      expect(state?.reconnectCount).toBe(0);
    });

    it("should fail to connect disabled server", async () => {
      const config = createTestConfig("server-1", { enabled: false });
      await registry.registerServer(config);

      await expect(registry.connectServer("server-1")).rejects.toThrow("disabled");
    });
  });

  describe("Tool Discovery", () => {
    it("should discover tools", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      const tools = await registry.discoverTools("server-1");
      expect(Array.isArray(tools)).toBe(true);
    });

    it("should return empty tools for disconnected server", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);

      const tools = await registry.discoverTools("server-1");
      expect(tools.length).toBe(0);
    });
  });

  describe("Resource Discovery", () => {
    it("should discover resources", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      const resources = await registry.discoverResources("server-1");
      expect(Array.isArray(resources)).toBe(true);
    });
  });

  describe("Prompt Discovery", () => {
    it("should discover prompts", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      const prompts = await registry.discoverPrompts("server-1");
      expect(Array.isArray(prompts)).toBe(true);
    });
  });

  describe("Tool Execution", () => {
    it("should call a tool", async () => {
      const mock = await startMockMcpServer((method) => {
        if (method === "initialize") {
          return {
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "mock-mcp", version: "1.0.0" },
          };
        }
        if (method === "tools/call") {
          return { content: [{ type: "text", text: "file contents" }] };
        }
        throw new Error(`unexpected method ${method}`);
      });
      try {
        const config = createTestConfig("server-1", {
          transport: "sse",
          url: mock.url,
        });
        await registry.registerServer(config);
        await registry.connectServer("server-1");

        const result = (await registry.callTool("server-1", "read_file", { path: "/test" })) as {
          content?: { content?: Array<{ text?: string }> };
        };
        expect(result.content?.content?.[0]?.text).toBe("file contents");
      } finally {
        await mock.close();
      }
    });

    it("should reject tool call when server is unreachable", async () => {
      // Bind then close to get a port nothing listens on.
      const mock = await startMockMcpServer(() => ({}));
      const url = mock.url;
      await mock.close();

      const config = createTestConfig("server-1", { transport: "sse", url });
      await registry.registerServer(config);
      await expect(registry.connectServer("server-1")).rejects.toThrow();
      await expect(registry.callTool("server-1", "read_file", { path: "/test" })).rejects.toThrow(
        "not connected"
      );
    });

    it("should deny tool call with no permissions", async () => {
      const config = createTestConfig("server-1", {
        permissions: { tools: "none", resources: "read", prompts: "read" },
      });
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      await expect(registry.callTool("server-1", "read_file", { path: "/test" })).rejects.toThrow(
        "Tool access denied"
      );
    });
  });

  describe("Health Check", () => {
    it("should return healthy status for connected server", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      const health = await registry.healthCheck("server-1");
      expect(health.status).toBe("healthy");
    });

    it("should return unknown status for non-existent server", async () => {
      const health = await registry.healthCheck("nonexistent");
      expect(health.status).toBe("unknown");
    });
  });

  describe("Audit Log", () => {
    it("should record audit events", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      const log = registry.getAuditLog({ serverId: "server-1" });
      expect(log.length).toBeGreaterThan(0);
    });

    it("should filter audit log by action", async () => {
      const config = createTestConfig("server-1");
      await registry.registerServer(config);
      await registry.connectServer("server-1");

      const log = registry.getAuditLog({ action: "connect" });
      expect(log.length).toBeGreaterThan(0);
    });
  });

  describe("Workspace and Project Config", () => {
    it("should set workspace config", async () => {
      await registry.setWorkspaceConfig({
        workspaceId: "ws-1",
        servers: [createTestConfig("server-1")],
        globalPermissions: { tools: "read", resources: "read", prompts: "read" },
      });

      const config = registry.getWorkspaceConfig("ws-1");
      expect(config).toBeDefined();
      expect(config?.servers.length).toBe(1);
    });

    it("should set project config", async () => {
      await registry.setProjectConfig({
        projectId: "proj-1",
        workspaceId: "ws-1",
        servers: [createTestConfig("server-1")],
      });

      const config = registry.getProjectConfig("proj-1");
      expect(config).toBeDefined();
    });
  });
});

describe("MCPConnectionManager", () => {
  let manager: MCPConnectionManager;

  beforeEach(() => {
    manager = new MCPConnectionManager();
  });

  it("should add and remove servers", async () => {
    const config = createTestConfig("server-1");
    await manager.addServer(config);

    const servers = await manager.listServers();
    expect(servers.length).toBe(1);

    await manager.removeServer("server-1");
    const serversAfter = await manager.listServers();
    expect(serversAfter.length).toBe(0);
  });

  it("should connect and disconnect", async () => {
    const config = createTestConfig("server-1");
    await manager.addServer(config);

    const connection = await manager.connect("server-1");
    expect(connection.status).toBe("connected");

    await manager.disconnect("server-1");
    const server = await manager.getServer("server-1");
    expect(server?.status).toBe("disconnected");
  });

  it("should discover tools through manager", async () => {
    const config = createTestConfig("server-1");
    await manager.addServer(config);
    await manager.connect("server-1");

    const tools = await manager.getTools("server-1");
    expect(Array.isArray(tools)).toBe(true);
  });

  it("should shutdown cleanly", async () => {
    await manager.addServer(createTestConfig("server-1"));
    await manager.addServer(createTestConfig("server-2"));
    await manager.connect("server-1");
    await manager.connect("server-2");

    await manager.shutdown();

    const server1 = await manager.getServer("server-1");
    const server2 = await manager.getServer("server-2");
    expect(server1?.status).toBe("disconnected");
    expect(server2?.status).toBe("disconnected");
  });
});
