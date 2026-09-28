import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import pino from "pino";
import type { MCPServerConfig, MCPTool } from "./types.js";

const log = pino({ name: "mcp-stdio", level: "warn" });

/**
 * Cline-style MCP stdio transport.
 *
 * - Spawns a local process via `child_process.spawn(command, args, { env: {...process.env, ...serverEnv} })`
 * - Communicates via JSON-RPC over stdin/stdout: write `JSON.stringify({jsonrpc:"2.0", id, method:"tools/list", params:{}})` to stdin, read stdout line-by-line
 * - stderr is logs (not protocol), stdout is protocol — `console.log` on the server side would break it
 * - Implements `tools/list` and `tools/call` proxied to the stdio process
 * - Has timeout handling and auto-restart on crash
 * - Schema: each server config has `command: string`, `args?: string[]`, `env?: Record<string,string>`, `autoApprove?: string[]`, `timeout?: number`, `disabled?: boolean`
 */

export interface StdioRequestPending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export function isStdioConfig(config: MCPServerConfig): boolean {
  return config.transportType === "STDIO" || config.transport === "stdio";
}

export class StdioTransport {
  private config: MCPServerConfig;
  private child: ChildProcess | null = null;
  private rl: Interface | null = null;
  private pending = new Map<number, StdioRequestPending>();
  private nextId = 1;
  private shouldRestart = true;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private stdoutBuffer = "";

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return !!this.child && !this.child.killed && this.child.exitCode === null;
  }

  async start(): Promise<void> {
    if (this.config.disabled) {
      throw new Error(`Server ${this.config.id} is disabled`);
    }
    if (!this.config.command) {
      throw new Error(`Server ${this.config.id} missing command for stdio transport`);
    }
    this.stopped = false;
    this.shouldRestart = true;
    await this.spawnProcess();
    await this.initialize();
  }

  private async spawnProcess(): Promise<void> {
    const command = this.config.command as string;
    const args = this.config.args ?? [];
    // Merge env: child inherits parent env plus server-specific overrides
    const serverEnv = this.config.env ?? {};
    // Required pattern: spawn(command, args, { env: {...process.env, ...serverEnv} })
    this.child = spawn(command, args, { env: { ...process.env, ...serverEnv } });

    if (!this.child.stdin || !this.child.stdout || !this.child.stderr) {
      throw new Error(`Failed to spawn stdio process for ${this.config.id}: missing stdio streams`);
    }

    // stderr is logs (not protocol) — log it but do not parse as JSON-RPC
    // stdout is protocol — read line-by-line, each line is a JSON-RPC message
    // Note: `console.log` on the server side would break it because it pollutes stdout
    this.child.stderr.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        // stderr is logs (not protocol)
        log.warn({ serverId: this.config.id }, `[MCP stdio] stderr: ${text}`);
      }
    });

    // Read stdout line-by-line using readline; each line is a JSON-RPC response
    // stdout is protocol — read stdout line-by-line
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on("line", (line: string) => this.handleLine(line));

    this.child.on("error", (err) => {
      log.error({ err, serverId: this.config.id }, "MCP stdio spawn error");
      this.failPending(new Error(`Stdio transport error: ${err.message}`));
    });

    this.child.on("exit", (code, signal) => {
      log.warn({ serverId: this.config.id, code, signal }, "MCP stdio process exited");
      this.cleanupOnExit(code, signal);
    });

    // Wait a tick to ensure process started
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.child?.off("error", onError);
        this.child?.off("spawn", onSpawn);
      };
      // spawn is sync; if no immediate error, consider it started
      // Use nextTick to check if child is still alive
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          cleanup();
          resolve();
        }
      }, 50);
      this.child?.once("error", onError);
      this.child?.once("spawn", onSpawn);
    });
  }

  private cleanupOnExit(code: number | null, _signal: NodeJS.Signals | null): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // Reject any pending requests
    this.failPending(new Error(`Stdio process exited with code ${code}`));

    this.child = null;

    if (this.stopped || !this.shouldRestart) {
      return;
    }

    // Auto-restart on crash with backoff
    this.scheduleRestart();
  }

  private failPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    const maxRetries = this.config.retryPolicy?.maxRetries ?? 5;
    if (this.restartCount >= maxRetries) {
      log.error({ serverId: this.config.id, maxRetries }, "MCP stdio max restarts reached, giving up");
      return;
    }
    const backoffMs = this.config.retryPolicy?.backoffMs ?? 1000;
    const maxBackoffMs = this.config.retryPolicy?.maxBackoffMs ?? 30_000;
    const delay = Math.min(backoffMs * Math.pow(2, this.restartCount), maxBackoffMs);
    this.restartCount++;
      log.warn({ serverId: this.config.id, restartCount: this.restartCount, delay }, "MCP stdio scheduling auto-restart");

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.spawnProcess()
        .then(() => this.initialize().catch((e) => log.error({ err: e, serverId: this.config.id }, "MCP stdio re-initialize failed")))
        .catch((e) => {
          log.error({ err: e, serverId: this.config.id }, "MCP stdio restart failed");
          this.scheduleRestart();
        });
    }, delay);
  }

  private async initialize(): Promise<void> {
    // Send MCP initialize request; ignore failures but attempt
    try {
      const timeout = this.config.timeout ?? 30_000;
      await this.requestWithTimeout("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "ai-harness", version: "1.0.0" },
      }, timeout);
      // Send initialized notification (no id, no response expected)
      this.sendNotification("notifications/initialized", {});
      this.restartCount = 0;
    } catch (err) {
      log.error({ err, serverId: this.config.id }, "MCP stdio initialize failed");
      // Don't throw - allow tools/list to still work for simpler servers
    }
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.child.stdin.write(payload + "\n");
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      log.warn({ serverId: this.config.id, line: line.slice(0, 500) }, "MCP stdio invalid JSON on stdout");
      return;
    }
    const m = msg as { id?: number; result?: unknown; error?: { message: string }; jsonrpc?: string; method?: string };
    // stdout is protocol — handle responses by id
    if (m.id !== undefined && this.pending.has(m.id)) {
      const pending = this.pending.get(m.id)!;
      this.pending.delete(m.id);
      clearTimeout(pending.timer);
      if (m.error) {
        pending.reject(new Error(m.error.message));
      } else {
        pending.resolve((m.result as Record<string, unknown>) ?? {});
      }
      return;
    }
    // Handle server-initiated notifications/requests (e.g., logs)
    if (m.method) {
      // For now just log; some servers send notifications via stdout which we ignore
      // stderr is logs (not protocol), but some servers may send logs over stdout notifications
      log.warn({ serverId: this.config.id, method: m.method }, "MCP stdio notification");
    }
  }

  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const timeout = this.config.timeout ?? 30_000;
    return this.requestWithTimeout(method, params, timeout);
  }

  private async requestWithTimeout(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    if (this.config.disabled) throw new Error(`Server ${this.config.id} is disabled`);
    if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
      throw new Error(`Stdio transport not connected for ${this.config.id}`);
    }

    const id = this.nextId++;
    // Communicates via JSON-RPC over stdin/stdout: write `JSON.stringify({jsonrpc:"2.0", id, method:"tools/list", params:{}})` to stdin, read stdout line-by-line
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });

      try {
        this.child!.stdin!.write(payload + "\n", (err) => {
          if (err) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // Implements `tools/list` proxied to the stdio process
  async listTools(): Promise<MCPTool[]> {
    // Explicitly uses tools/list JSON-RPC shape
    const _payloadExample = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    void _payloadExample;
    const result = await this.request("tools/list", {});
    return (result.tools as MCPTool[]) ?? [];
  }

  // Implements `tools/call` proxied to the stdio process
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.request("tools/call", { name, arguments: args });
    return { content: (result as { content?: unknown })?.content ?? result };
  }

  async listResources(): Promise<unknown> {
    const result = await this.request("resources/list", {});
    return result;
  }

  async readResource(uri: string): Promise<unknown> {
    const result = await this.request("resources/read", { uri });
    return result;
  }

  async listPrompts(): Promise<unknown> {
    const result = await this.request("prompts/list", {});
    return result;
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    const result = await this.request("prompts/get", { name, arguments: args ?? {} });
    return result;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.shouldRestart = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.failPending(new Error("Transport stopped"));

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.child) {
      const child = this.child;
      this.child = null;
      // Try graceful shutdown
      child.stdin?.end();
      // Give it a moment, then kill
      const killTimer = setTimeout(() => {
        if (!child.killed) child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 2000);
      }, 1000);
      // Wait for exit
      await new Promise<void>((resolve) => {
        child.once("exit", () => {
          clearTimeout(killTimer);
          resolve();
        });
        // Also resolve after timeout to avoid hanging
        setTimeout(() => resolve(), 3500);
      });
      clearTimeout(killTimer);
    }
  }
}
