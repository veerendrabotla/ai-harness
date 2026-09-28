import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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

export interface DockerEngine {
  executeInContainer(id: string, command: string, options?: { timeout?: number; cwd?: string; env?: Record<string, string> }): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number }>;
  startProcess(id: string, command: string, options?: { cwd?: string; env?: Record<string, string> }): Promise<{ id: string; containerId: string; command: string; pid: number; startedAt: Date; status: string }>;
  destroyContainer(id: string): Promise<void>;
  getContainer(id: string): { id: string; state: string } | undefined;
  getContainerStats(id: string): Promise<{ cpuUsage: number; memoryUsage: number; memoryLimit: number; networkRx: number; networkTx: number; blockIoRead: number; blockIoWrite: number; pidsCurrent: number } | null>;
  healthCheck(id: string): Promise<{ status: string; failingStreak: number; output: string; lastChecked: Date }>;
}

export class DockerSandboxProvider implements ExecutionProvider {
  readonly type = "docker" as const;
  private _status: "connected" | "disconnected" | "error" = "connected";
  private containerId: string;
  private engine: DockerEngine;
  private workspaceDir: string;
  private previewProcessId: string | null = null;
  private previewUrl: string | null = null;
  private processCounter = 0;

  constructor(
    readonly id: string,
    engine: DockerEngine,
    containerId: string,
    workspaceDir: string,
  ) {
    this.engine = engine;
    this.containerId = containerId;
    this.workspaceDir = workspaceDir;
  }

  get status() {
    const container = this.engine.getContainer(this.containerId);
    if (!container || container.state !== "running") {
      this._status = "disconnected";
    }
    return this._status;
  }

  async readFile(path: string): Promise<string> {
    this.ensureConnected();
    const result = await this.engine.executeInContainer(
      this.containerId,
      `cat ${this.sanitizePath(path)}`,
      { timeout: 10_000 }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }
    return result.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.ensureConnected();
    const sanitized = this.sanitizePath(path);
    const dir = sanitized.substring(0, sanitized.lastIndexOf("/"));
    if (dir) {
      await this.engine.executeInContainer(
        this.containerId,
        `mkdir -p ${dir}`,
        { timeout: 5_000 }
      );
    }
    await this.engine.executeInContainer(
      this.containerId,
      `cat > ${sanitized} << 'AIHARNESS_EOF'\n${content}\nAIHARNESS_EOF`,
      { timeout: 30_000 }
    );
  }

  async deletePath(path: string): Promise<void> {
    this.ensureConnected();
    const sanitized = this.sanitizePath(path);
    await this.engine.executeInContainer(
      this.containerId,
      `rm -rf ${sanitized}`,
      { timeout: 10_000 }
    );
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    this.ensureConnected();
    const sanitized = this.sanitizePath(path || ".");
    const result = await this.engine.executeInContainer(
      this.containerId,
      `find ${sanitized} -maxdepth 1 -printf '%T@\\t%s\\t%y\\t%f\\n' 2>/dev/null || ls -la ${sanitized}`,
      { timeout: 10_000 }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list files: ${result.stderr}`);
    }

    const entries: FileEntry[] = [];
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const name = parts[parts.length - 1] || "";
        if (name === "." || name === "..") continue;
        entries.push({
          name,
          type: parts[2] === "d" ? "directory" : "file",
          size: parseInt(parts[1] || "0") || 0,
          modifiedAt: new Date(parseFloat(parts[0] || "0") * 1000),
        });
      } else {
        const name = line.trim().split(/\s+/).pop() || line.trim();
        if (name === "." || name === "..") continue;
        entries.push({
          name,
          type: "file",
          size: 0,
          modifiedAt: new Date(),
        });
      }
    }
    return entries;
  }

  async mkdir(path: string): Promise<void> {
    this.ensureConnected();
    const sanitized = this.sanitizePath(path);
    await this.engine.executeInContainer(
      this.containerId,
      `mkdir -p ${sanitized}`,
      { timeout: 5_000 }
    );
  }

  async execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult> {
    this.ensureConnected();
    const execOptions: { timeout?: number; cwd?: string; env?: Record<string, string> } = {};
    if (options?.timeout) execOptions.timeout = options.timeout;
    if (options?.cwd) execOptions.cwd = options.cwd;
    if (options?.env) execOptions.env = options.env;

    const result = await this.engine.executeInContainer(
      this.containerId,
      command,
      execOptions
    );
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
    };
  }

  async startProcess(command: string, options?: StartProcessOptions): Promise<ProcessHandle> {
    this.ensureConnected();
    const processId = randomUUID();
    await this.engine.startProcess(this.containerId, command, {
      cwd: options?.cwd,
      env: options?.env,
    });
    this.processCounter++;
    return {
      id: processId,
      pid: this.processCounter,
      command,
      startedAt: new Date(),
    };
  }

  async stopProcess(processId: string): Promise<void> {
    this.ensureConnected();
    await this.engine.executeInContainer(
      this.containerId,
      `pkill -f "${processId}" || true`,
      { timeout: 5_000 }
    );
  }

  async getProcessLogs(_processId: string, _offset?: number): Promise<ProcessLogs> {
    this.ensureConnected();
    return { stdout: "", stderr: "", exited: true, exitCode: 0 };
  }

  async gitCommit(message: string): Promise<string> {
    this.ensureConnected();
    const result = await this.engine.executeInContainer(
      this.containerId,
      `git add -A && git commit -m "${message.replace(/"/g, '\\"')}"`,
      { timeout: 30_000 }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Git commit failed: ${result.stderr}`);
    }
    const hashResult = await this.engine.executeInContainer(
      this.containerId,
      `git rev-parse HEAD`,
      { timeout: 5_000 }
    );
    return hashResult.stdout.trim();
  }

  async gitLog(limit?: number): Promise<GitCommit[]> {
    this.ensureConnected();
    const maxCount = limit || 10;
    const result = await this.engine.executeInContainer(
      this.containerId,
      `git log --format='%H|%s|%an|%aI' -n ${maxCount}`,
      { timeout: 10_000 }
    );
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split("\n").filter(Boolean).map((line: string) => {
      const parts = line.split("|");
      return {
        hash: parts[0] || "",
        message: parts[1] || "",
        author: parts[2] || "",
        date: new Date(parts[3] || ""),
      };
    });
  }

  async gitDiff(): Promise<string> {
    this.ensureConnected();
    const result = await this.engine.executeInContainer(
      this.containerId,
      `git diff`,
      { timeout: 10_000 }
    );
    return result.stdout;
  }

  async startPreview(command: string, port: number): Promise<PreviewHandle> {
    this.ensureConnected();
    const processHandle = await this.startProcess(command);
    this.previewProcessId = processHandle.id;
    this.previewUrl = `http://localhost:${port}`;
    return { url: this.previewUrl, processId: processHandle.id };
  }

  async stopPreview(): Promise<void> {
    if (this.previewProcessId) {
      await this.stopProcess(this.previewProcessId);
      this.previewProcessId = null;
      this.previewUrl = null;
    }
  }

  async getPreviewStatus(): Promise<PreviewStatus> {
    return {
      active: this.previewProcessId !== null,
      url: this.previewUrl,
      processId: this.previewProcessId,
    };
  }

  async destroy(): Promise<void> {
    await this.stopPreview();
    await this.engine.destroyContainer(this.containerId);
    this._status = "disconnected";
  }

  async getContainerStats() {
    return this.engine.getContainerStats(this.containerId);
  }

  async healthCheck() {
    return this.engine.healthCheck(this.containerId);
  }

  private ensureConnected(): void {
    if (this.status !== "connected") {
      throw new Error("Docker container is not connected");
    }
  }

  private sanitizePath(path: string): string {
    const resolved = resolve("/workspace", path);
    if (!resolved.startsWith("/workspace")) {
      throw new Error(`Path traversal detected: ${path}`);
    }
    return resolved;
  }
}
