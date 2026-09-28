/**
 * Cloud Sandbox Execution Provider.
 * Executes operations in an isolated cloud sandbox environment.
 */
import { SandboxEngine } from "@ai-harness/sandbox-engine";
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
  ResourceLimits,
} from "./types.js";

export class CloudSandboxProvider implements ExecutionProvider {
  readonly type = "cloud_sandbox" as const;
  readonly id: string;
  private sandboxId: string;
  private engine: SandboxEngine;
  private limits: ResourceLimits;
  private previewProcessId: string | null = null;
  private previewPort: number = 3000;

  constructor(id: string, sandboxId: string, engine: SandboxEngine, limits: ResourceLimits = {}) {
    this.id = id;
    this.sandboxId = sandboxId;
    this.engine = engine;
    this.limits = {
      maxCpuMs: limits.maxCpuMs ?? 300_000,
      maxMemoryBytes: limits.maxMemoryBytes ?? 2 * 1024 * 1024 * 1024,
      maxDiskBytes: limits.maxDiskBytes ?? 5 * 1024 * 1024 * 1024,
      maxProcesses: limits.maxProcesses ?? 20,
      maxCommandTimeoutMs: limits.maxCommandTimeoutMs ?? 60_000,
      maxIdleTimeoutMs: limits.maxIdleTimeoutMs ?? 900_000,
      maxLifetimeMs: limits.maxLifetimeMs ?? 3_600_000,
      ...limits,
    };
  }

  get status(): "connected" | "disconnected" | "error" {
    const sandbox = this.engine.getSandbox(this.sandboxId);
    if (!sandbox || sandbox.status === "destroyed") return "disconnected";
    if (sandbox.status === "error") return "error";
    return "connected";
  }

  // ── Filesystem ──────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    return this.engine.readFile(this.sandboxId, path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.engine.writeFile(this.sandboxId, path, content);
  }

  async deletePath(path: string): Promise<void> {
    await this.engine.deletePath(this.sandboxId, path);
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    return this.engine.listFiles(this.sandboxId, path);
  }

  async mkdir(path: string): Promise<void> {
    await this.engine.writeFile(this.sandboxId, `${path}/.gitkeep`, "");
  }

  // ── Execution ───────────────────────────────────────────

  async execute(command: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const timeout = Math.min(options.timeout ?? this.limits.maxCommandTimeoutMs ?? 60_000, this.limits.maxCommandTimeoutMs ?? 60_000);
    const result = await this.engine.execute(this.sandboxId, command, {
      cwd: options.cwd,
      env: options.env,
      timeout,
    });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: 0,
    };
  }

  async startProcess(command: string, _options: StartProcessOptions = {}): Promise<ProcessHandle> {
    // Cloud sandbox uses background processes via startDevServer
    const result = await this.engine.startDevServer(this.sandboxId, command, 0);
    return {
      id: result.processId,
      pid: undefined,
      command,
      startedAt: new Date(),
    };
  }

  async stopProcess(processId: string): Promise<void> {
    await this.engine.stopProcess(this.sandboxId, processId);
  }

  async getProcessLogs(processId: string, offset: number = 0): Promise<ProcessLogs> {
    const logs = await this.engine.getProcessLogs(this.sandboxId, processId, offset);
    return {
      stdout: logs.stdout,
      stderr: logs.stderr,
      exited: logs.exited,
      exitCode: null,
    };
  }

  // ── Git ─────────────────────────────────────────────────

  async gitCommit(message: string): Promise<string> {
    await this.execute("git add -A");
    const result = await this.execute(`git commit -m "${message}"`);
    if (result.exitCode !== 0) throw new Error(`Git commit failed: ${result.stderr}`);
    const logResult = await this.execute("git log -1 --format=%H");
    return logResult.stdout.trim();
  }

  async gitLog(limit: number = 10): Promise<GitCommit[]> {
    const result = await this.execute(`git log --format=%H|%s|%an|%ai -n ${limit}`);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, message, author, dateStr] = line.split("|");
      return {
        hash: hash ?? "",
        message: message ?? "",
        author: author ?? "",
        date: new Date(dateStr ?? ""),
      };
    });
  }

  async gitDiff(): Promise<string> {
    const result = await this.execute("git diff");
    return result.stdout;
  }

  // ── Preview ─────────────────────────────────────────────

  async startPreview(command: string, port: number): Promise<PreviewHandle> {
    const result = await this.engine.startDevServer(this.sandboxId, command, port);
    this.previewProcessId = result.processId;
    this.previewPort = port;
    return { url: result.url, processId: result.processId };
  }

  async stopPreview(): Promise<void> {
    if (this.previewProcessId) {
      await this.engine.stopProcess(this.sandboxId, this.previewProcessId);
      this.previewProcessId = null;
    }
  }

  async getPreviewStatus(): Promise<PreviewStatus> {
    if (!this.previewProcessId) return { active: false, url: null, processId: null };
    const logs = await this.engine.getProcessLogs(this.sandboxId, this.previewProcessId);
    return {
      active: !logs.exited,
      url: logs.exited ? null : `http://localhost:${this.previewPort}`,
      processId: this.previewProcessId,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  async destroy(): Promise<void> {
    await this.stopPreview();
    await this.engine.destroySandbox(this.sandboxId);
  }
}
