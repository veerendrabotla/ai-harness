import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
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

export interface WebContainerAPI {
  boot(config: { name: string; template?: string }): Promise<WebContainerInstance>;
}

export interface WebContainerInstance {
  id: string;
  status: "creating" | "running" | "stopped" | "error";
  mount(files: Record<string, string>): Promise<void>;
  spawn(command: string, args?: string[]): WebContainerProcess;
  compose(services: Record<string, { command: string; cwd?: string }>): Promise<void>;
  fs: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    rm(path: string): Promise<void>;
    ls(path: string): Promise<string[]>;
    mkdir(path: string): Promise<void>;
  };
  on(event: string, callback: (...args: never[]) => void): void;
  shutdown(): Promise<void>;
}

export interface WebContainerProcess {
  pid: number;
  output: ReadableStream<string>;
  exit: Promise<{ exitCode: number }>;
  kill(): void;
}

export interface WebContainerConfig {
  apiKey?: string;
  template?: string;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

export class WebContainerProvider implements ExecutionProvider {
  readonly type = "webcontainer" as const;
  private _status: "connected" | "disconnected" | "error" = "disconnected";
  private instance: WebContainerInstance | null = null;
  private files: Map<string, string> = new Map();
  private previewProcessId: string | null = null;
  private previewUrl: string | null = null;
  private config: WebContainerConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private createdAt: number;
  private expiresAt: number;
  private workDir: string | null = null;

  constructor(
    readonly id: string,
    config: WebContainerConfig = {},
  ) {
    this.config = config;
    this.createdAt = Date.now();
    this.expiresAt = this.createdAt + (config.ttlMs || DEFAULT_TTL_MS);
  }

  get status() {
    if (!this.instance || this.instance.status === "stopped" || this.instance.status === "error") {
      this._status = "disconnected";
    }
    return this._status;
  }

  async boot(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error(
        "WebContainer requires a StackBlitz API key. " +
        "Set WEBCONTAINER_API_KEY environment variable or pass apiKey in config. " +
        "Get your key at: https://webcontainers.io/guides/getting-started"
      );
    }

    try {
      const api = await this.createAPI();
      this.instance = await api.boot({
        name: `aiharness-${this.id}`,
        template: this.config.template,
      });

      this._status = "connected";

      this.instance.on("port", (port: number, url: string) => {
        this.previewUrl = url;
      });

      this.instance.on("error", (err: Error) => {
        console.error(`WebContainer error: ${err.message}`);
        this._status = "error";
      });

      this.startCleanup();
    } catch (err) {
      this._status = "error";
      throw new Error(
        `Failed to boot WebContainer: ${err instanceof Error ? err.message : String(err)}. ` +
        "Ensure your API key is valid and StackBlitz services are available."
      );
    }
  }

  async readFile(path: string): Promise<string> {
    this.ensureConnected();
    return this.instance!.fs.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.ensureConnected();
    this.files.set(path, content);
    await this.instance!.fs.writeFile(path, content);
  }

  async deletePath(path: string): Promise<void> {
    this.ensureConnected();
    this.files.delete(path);
    await this.instance!.fs.rm(path);
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    this.ensureConnected();
    const names = await this.instance!.fs.ls(path);
    return names.map((name) => ({
      name,
      type: "file" as const,
      size: 0,
      modifiedAt: new Date(),
    }));
  }

  async mkdir(path: string): Promise<void> {
    this.ensureConnected();
    await this.instance!.fs.mkdir(path);
  }

  async execute(command: string, _options?: ExecuteOptions): Promise<ExecuteResult> {
    this.ensureConnected();
    const start = Date.now();

    try {
      const args = command.split(" ");
      const cmd = args.shift() || command;
      const proc = this.instance!.spawn(cmd, args);
      const output = await this.collectOutput(proc.output);
      const { exitCode } = await proc.exit;
      const duration = Date.now() - start;

      return {
        exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
        duration,
      };
    } catch (err) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      };
    }
  }

  async startProcess(command: string, _options?: StartProcessOptions): Promise<ProcessHandle> {
    this.ensureConnected();
    const processId = randomUUID();
    const args = command.split(" ");
    const cmd = args.shift() || command;
    const proc = this.instance!.spawn(cmd, args);

    void proc.exit.then(({ exitCode }) => {
      if (exitCode !== 0) {
        console.error(`Process ${processId} exited with code ${exitCode}`);
      }
    });

    return {
      id: processId,
      pid: proc.pid,
      command,
      startedAt: new Date(),
    };
  }

  async stopProcess(_processId: string): Promise<void> {
    this.ensureConnected();
  }

  async getProcessLogs(_processId: string, _offset?: number): Promise<ProcessLogs> {
    this.ensureConnected();
    return { stdout: "", stderr: "", exited: true, exitCode: 0 };
  }

  async gitCommit(message: string): Promise<string> {
    this.ensureConnected();
    const result = await this.execute(`git add -A && git commit -m "${message}"`);
    if (result.exitCode !== 0) {
      throw new Error(`Git commit failed: ${result.stderr}`);
    }
    const hashResult = await this.execute("git rev-parse HEAD");
    return hashResult.stdout.trim();
  }

  async gitLog(limit?: number): Promise<GitCommit[]> {
    this.ensureConnected();
    const maxCount = limit || 10;
    const result = await this.execute(`git log --format='%H|%s|%an|%aI' -n ${maxCount}`);
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
    const result = await this.execute("git diff");
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
    if (this.instance) {
      await this.instance.shutdown();
    }
    this._status = "disconnected";
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async syncFiles(files: Record<string, string>): Promise<{ synced: number }> {
    this.ensureConnected();
    let count = 0;
    for (const [path, content] of Object.entries(files)) {
      await this.writeFile(path, content);
      count++;
    }
    return { synced: count };
  }

  async runInTerminal(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.execute(command);
  }

  private async createAPI(): Promise<WebContainerAPI> {
    const workDir = join(process.cwd(), ".webcontainer", randomUUID());
    await mkdir(workDir, { recursive: true });
    this.workDir = workDir;

    // Try to use real WebContainer API if available (e.g., in StackBlitz environment)
    try {
      // Dynamic import — package may not be installed
      const wc = (await Function("return import('@webcontainer/api')")()) as {
        WebContainer?: { boot: (config: { name: string; template?: string }) => Promise<WebContainerInstance> };
      };
      const api = wc?.WebContainer;
      if (api) {
        return {
          boot: async (config) => api.boot(config),
        };
      }
    } catch (err) {
      console.error("[WebContainer] API not available, using subprocess fallback:", err);
    }

    // Subprocess-based implementation for local Node.js environments
    const processes = new Map<number, ChildProcess>();
    const eventListeners = new Map<string, Set<(data: unknown) => void>>();

    function emitEvent(event: string, data: unknown): void {
      const listeners = eventListeners.get(event);
      if (listeners) {
        for (const listener of listeners) {
          try { listener(data); } catch (err) { console.warn(`[WebContainer] Event listener error for "${event}":`, err); }
        }
      }
    }

    return {
      boot: async (_config) => {
        const instanceId = randomUUID();
        await mkdir(workDir, { recursive: true });

        const instance: WebContainerInstance = {
          id: instanceId,
          status: "running" as const,
          mount: async (files: Record<string, string>) => {
            for (const [path, content] of Object.entries(files)) {
              const fullPath = resolve(workDir, path);
              await mkdir(join(fullPath, ".."), { recursive: true }).catch((err) => { console.warn("[WebContainer] mkdir failed during mount:", err); });
              await writeFile(fullPath, content);
            }
          },
          spawn: (command: string, args?: string[]) => {
            const pid = Date.now();
            const child = spawn(command, args ?? [], {
              cwd: workDir,
              stdio: ["pipe", "pipe", "pipe"],
              shell: true,
            });

            processes.set(pid, child);
            emitEvent("spawn", { pid, command, args });

            const output = new ReadableStream<string>({
              start(controller) {
                child.stdout?.on("data", (data: Buffer) => {
                  const text = data.toString();
                  controller.enqueue(text);
                  emitEvent("output", { pid, stream: "stdout", data: text });
                });
                child.stderr?.on("data", (data: Buffer) => {
                  const text = data.toString();
                  controller.enqueue(text);
                  emitEvent("output", { pid, stream: "stderr", data: text });
                });
                child.on("close", (code) => {
                  controller.close();
                  processes.delete(pid);
                  emitEvent("exit", { pid, exitCode: code ?? 1 });
                });
                child.on("error", (err) => {
                  controller.error(err);
                  processes.delete(pid);
                  emitEvent("error", { pid, error: err.message });
                });
              },
            });

            return {
              pid,
              output,
              exit: new Promise<{ exitCode: number }>((resolve) => {
                child.on("close", (code) => resolve({ exitCode: code ?? 1 }));
              }),
              kill: () => {
                child.kill("SIGTERM");
                processes.delete(pid);
              },
            };
          },
          compose: async (services: Record<string, { command: string; cwd?: string }>) => {
            for (const [, svc] of Object.entries(services)) {
              const parts = svc.command.split(" ");
              const cmd = parts[0] ?? "echo";
              const args = parts.slice(1);
              spawn(cmd, args, { cwd: svc.cwd ?? workDir, stdio: "inherit", shell: true } as SpawnOptions);
            }
          },
          fs: {
            readFile: async (path: string) => readFile(resolve(workDir, path), "utf-8"),
            writeFile: async (path: string, content: string) => {
              const fullPath = resolve(workDir, path);
              await mkdir(join(fullPath, ".."), { recursive: true }).catch((err) => { console.warn("[WebContainer] mkdir failed during writeFile:", err); });
              await writeFile(fullPath, content);
            },
            rm: async (path: string) => rm(resolve(workDir, path), { recursive: true, force: true }),
            ls: async (path: string) => (await readdir(resolve(workDir, path))) as string[],
            mkdir: async (path: string) => { await mkdir(resolve(workDir, path), { recursive: true }); },
          },
          on: (event: string, listener: (...args: never[]) => void) => {
            if (!eventListeners.has(event)) {
              eventListeners.set(event, new Set());
            }
            eventListeners.get(event)!.add(listener as unknown as (data: unknown) => void);
          },
          shutdown: async () => {
            for (const [, child] of processes) {
              child.kill("SIGTERM");
            }
            processes.clear();
            eventListeners.clear();
          },
        };
        return instance;
      },
    };
  }

  private async collectOutput(stream: ReadableStream<string>): Promise<{ stdout: string; stderr: string }> {
    const reader = stream.getReader();
    let stdout = "";
    const stderr = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdout += value;
      }
    } catch (err) {
      console.error("[WebContainer] Failed to read stdout:", err);
    }
    return { stdout, stderr };
  }

  private ensureConnected(): void {
    if (this.status !== "connected") {
      throw new Error("WebContainer is not connected. Call boot() first.");
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      if (Date.now() > this.expiresAt) {
        void this.destroy();
      }
    }, CLEANUP_INTERVAL_MS);
  }

  isExpired(): boolean {
    return Date.now() > this.expiresAt;
  }
}
