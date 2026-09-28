import pino from "pino";
import type {
  MCPServerConfig,
  MCPServerState,
  MCPConnection,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPHealthStatus,
} from "./types.js";
import { MCPRegistry } from "./registry.js";

const log = pino({ name: "mcp-connection-manager", level: "warn" });

export class MCPConnectionManager {
  private registry: MCPRegistry;
  private healthCheckIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(registry?: MCPRegistry) {
    this.registry = registry || new MCPRegistry();
  }

  async addServer(config: MCPServerConfig): Promise<MCPServerState> {
    return this.registry.registerServer(config);
  }

  async removeServer(serverId: string): Promise<void> {
    this.stopHealthCheck(serverId);
    await this.registry.unregisterServer(serverId);
  }

  async connect(serverId: string): Promise<MCPConnection> {
    const connection = await this.registry.connectServer(serverId);
    this.startHealthCheck(serverId);
    return connection;
  }

  async disconnect(serverId: string): Promise<void> {
    this.stopHealthCheck(serverId);
    await this.registry.disconnectServer(serverId);
  }

  async reconnect(serverId: string): Promise<MCPConnection> {
    this.stopHealthCheck(serverId);
    return this.registry.reconnectServer(serverId);
  }

  async getTools(serverId: string): Promise<MCPTool[]> {
    return this.registry.discoverTools(serverId);
  }

  async getResources(serverId: string): Promise<MCPResource[]> {
    return this.registry.discoverResources(serverId);
  }

  async getPrompts(serverId: string): Promise<MCPPrompt[]> {
    return this.registry.discoverPrompts(serverId);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.registry.callTool(serverId, toolName, args);
  }

  async readResource(serverId: string, uri: string): Promise<unknown> {
    return this.registry.readResource(serverId, uri);
  }

  async getPrompt(serverId: string, promptName: string, args?: Record<string, string>): Promise<unknown> {
    return this.registry.getPrompt(serverId, promptName, args);
  }

  async healthCheck(serverId: string): Promise<MCPHealthStatus> {
    return this.registry.healthCheck(serverId);
  }

  async listServers(): Promise<MCPServerState[]> {
    return this.registry.listServers();
  }

  async listServersByWorkspace(workspaceId: string): Promise<MCPServerState[]> {
    return this.registry.listServersByWorkspace(workspaceId);
  }

  async listServersByProject(projectId: string): Promise<MCPServerState[]> {
    return this.registry.listServersByProject(projectId);
  }

  async getServer(serverId: string): Promise<MCPServerState | undefined> {
    return this.registry.getServer(serverId);
  }

  async updateServer(serverId: string, updates: Partial<MCPServerConfig>): Promise<void> {
    return this.registry.updateServerConfig(serverId, updates);
  }

  async getAuditLog(filters?: { serverId?: string; action?: string; limit?: number }) {
    return this.registry.getAuditLog(filters);
  }

  async shutdown(): Promise<void> {
    for (const [serverId] of this.healthCheckIntervals) {
      this.stopHealthCheck(serverId);
    }

    const servers = this.registry.listServers();
    for (const server of servers) {
      if (server.status === "connected") {
        await this.disconnect(server.id);
      }
    }
  }

  private startHealthCheck(serverId: string): void {
    if (this.healthCheckIntervals.has(serverId)) return;

    const interval = setInterval(async () => {
      try {
        await this.registry.healthCheck(serverId);
      } catch (err) {
        log.warn({ err, serverId }, "MCP health check failed");
      }
    }, 30_000);

    this.healthCheckIntervals.set(serverId, interval);
  }

  private stopHealthCheck(serverId: string): void {
    const interval = this.healthCheckIntervals.get(serverId);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(serverId);
    }
  }
}
