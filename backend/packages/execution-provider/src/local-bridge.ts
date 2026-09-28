/**
 * Local Bridge Execution Provider.
 * Executes operations through the Bridge Gateway on the user's machine.
 */
import { BridgeGatewayClient, errors, getEnv } from "@ai-harness/shared";
import type {
  ExecutionProvider,
  FileEntry,
  ExecuteOptions,
  ExecuteResult,
  StartProcessOptions,
  ProcessHandle,
  ProcessLogs,
  GitCommit,
  PreviewHandle,
  PreviewStatus,
} from "./types.js";

export class LocalBridgeProvider implements ExecutionProvider {
  readonly type = "local_bridge" as const;
  readonly id: string;
  private gw: BridgeGatewayClient;
  private bridgeId: string;
  private rootReference: string;
  private previewProcessId: string | null = null;
  private previewPort: number = 3000;
  private cachedStatus: "connected" | "disconnected" | "error" = "disconnected";
  private lastHealthCheck: number = 0;
  private static readonly HEALTH_CHECK_TTL_MS = 10_000;

  constructor(id: string, bridgeId: string, rootReference: string) {
    this.id = id;
    this.bridgeId = bridgeId;
    this.rootReference = rootReference;
    const env = getEnv();
    this.gw = new BridgeGatewayClient({
      baseUrl: env.BRIDGE_GATEWAY_URL,
      internalToken: env.BRIDGE_INTERNAL_TOKEN,
    });
  }

  get status(): "connected" | "disconnected" | "error" {
    if (Date.now() - this.lastHealthCheck > LocalBridgeProvider.HEALTH_CHECK_TTL_MS) {
      void this.checkHealth();
    }
    return this.cachedStatus;
  }

  private async checkHealth(): Promise<void> {
    try {
      const result = await this.gw.execute(this.bridgeId, "ping", {}, 5_000);
      this.cachedStatus = result.ok ? "connected" : "disconnected";
    } catch (err) {
      console.error("[Bridge] Health check failed:", err);
      this.cachedStatus = "disconnected";
    } finally {
      this.lastHealthCheck = Date.now();
    }
  }

  // ── Filesystem ──────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    const result = await this.gw.execute(this.bridgeId, "fs.read", { root: this.rootReference, path }, 10_000);
    if (!result.ok) throw errors.notFound(`File: ${path}`);
    return String(result.data?.content ?? "");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const result = await this.gw.execute(this.bridgeId, "fs.write", { root: this.rootReference, path, content }, 10_000);
    if (!result.ok) throw errors.internal(`Failed to write file: ${result.error?.message}`);
  }

  async deletePath(path: string): Promise<void> {
    await this.gw.execute(this.bridgeId, "fs.delete", { root: this.rootReference, path }, 10_000);
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const result = await this.gw.execute(this.bridgeId, "fs.list", { root: this.rootReference, path }, 10_000);
    if (!result.ok) return [];
    const entries = (result.data?.entries ?? []) as Array<{ name: string; type: string; size: number; modifiedAt: string }>;
    return entries.map((e) => ({
      name: e.name,
      type: e.type === "directory" ? "directory" as const : "file" as const,
      size: e.size,
      modifiedAt: new Date(e.modifiedAt),
    }));
  }

  async mkdir(path: string): Promise<void> {
    await this.gw.execute(this.bridgeId, "fs.mkdir", { root: this.rootReference, path }, 10_000);
  }

  // ── Execution ───────────────────────────────────────────

  async execute(command: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const start = Date.now();
    const result = await this.gw.execute(
      this.bridgeId,
      "process.start",
      { root: this.rootReference, command, cwd: options.cwd ?? "." },
      options.timeout ?? 300_000,
    );

    if (!result.ok) {
      return { exitCode: 1, stdout: "", stderr: result.error?.message ?? "Execution failed", duration: Date.now() - start };
    }

    const processId = result.data?.processId as string;
    // Wait for completion
    const exitCode = await this.waitForProcess(processId, options.timeout ?? 300_000);
    return { exitCode: exitCode ?? 1, stdout: "", stderr: "", duration: Date.now() - start };
  }

  async startProcess(command: string, options: StartProcessOptions = {}): Promise<ProcessHandle> {
    const result = await this.gw.execute(
      this.bridgeId,
      "process.start",
      { root: this.rootReference, command, cwd: options.cwd ?? "." },
      10_000,
    );
    if (!result.ok) throw errors.internal(`Failed to start process: ${result.error?.message}`);
    return {
      id: result.data?.processId as string,
      pid: undefined,
      command,
      startedAt: new Date(),
    };
  }

  async stopProcess(processId: string): Promise<void> {
    await this.gw.execute(this.bridgeId, "process.stop", { processId }, 10_000);
  }

  async getProcessLogs(processId: string, offset: number = 0): Promise<ProcessLogs> {
    const result = await this.gw.execute(this.bridgeId, "process.logs", { processId, offset }, 5_000);
    if (!result.ok) return { stdout: "", stderr: "", exited: true, exitCode: null };
    return {
      stdout: String(result.data?.logs ?? ""),
      stderr: "",
      exited: result.data?.exited === true,
      exitCode: result.data?.exitCode as number ?? null,
    };
  }

  // ── Git ─────────────────────────────────────────────────

  async gitCommit(message: string): Promise<string> {
    const result = await this.gw.execute(this.bridgeId, "git.commit", { root: this.rootReference, message }, 10_000);
    if (!result.ok) throw errors.internal(`Git commit failed: ${result.error?.message}`);
    return String(result.data?.hash ?? "");
  }

  async gitLog(limit: number = 10): Promise<GitCommit[]> {
    const result = await this.gw.execute(this.bridgeId, "git.log", { root: this.rootReference, limit }, 10_000);
    if (!result.ok) return [];
    return (result.data?.commits ?? []) as GitCommit[];
  }

  async gitDiff(): Promise<string> {
    const result = await this.gw.execute(this.bridgeId, "git.diff", { root: this.rootReference }, 10_000);
    if (!result.ok) return "";
    return String(result.data?.diff ?? "");
  }

  // ── Preview ─────────────────────────────────────────────

  async startPreview(command: string, port: number): Promise<PreviewHandle> {
    const result = await this.gw.execute(
      this.bridgeId,
      "process.start",
      { root: this.rootReference, command, cwd: "." },
      10_000,
    );
    if (!result.ok) throw errors.internal(`Failed to start preview: ${result.error?.message}`);
    this.previewProcessId = result.data?.processId as string;
    this.previewPort = port;
    return { url: `http://localhost:${port}`, processId: this.previewProcessId };
  }

  async stopPreview(): Promise<void> {
    if (this.previewProcessId) {
      await this.stopProcess(this.previewProcessId);
      this.previewProcessId = null;
    }
  }

  async getPreviewStatus(): Promise<PreviewStatus> {
    if (!this.previewProcessId) return { active: false, url: null, processId: null };
    const logs = await this.getProcessLogs(this.previewProcessId);
    return {
      active: !logs.exited,
      url: logs.exited ? null : `http://localhost:${this.previewPort}`,
      processId: this.previewProcessId,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  async destroy(): Promise<void> {
    await this.stopPreview();
  }

  // ── Internal ────────────────────────────────────────────

  private async waitForProcess(processId: string, timeoutMs: number): Promise<number | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.gw.execute(this.bridgeId, "process.status", { processId }, 5_000).catch(() => null);
      if (status?.ok && status.data?.status === "exited") {
        return Number(status.data.exitCode ?? 1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }
}
