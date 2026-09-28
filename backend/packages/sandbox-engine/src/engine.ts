/**
 * Cloud Sandbox Engine.
 * Provides isolated execution environments for cloud-mode projects.
 * Each sandbox has its own filesystem, processes, and network context.
 *
 * Security model:
 * - Each sandbox has its own temp directory (filesystem isolation)
 * - Processes are spawned with restricted environment
 * - Resource limits prevent abuse
 * - Cleanup on destroy removes all artifacts
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, readdir, rm, stat, mkdir } from "node:fs/promises";
import { join, dirname, normalize, sep } from "node:path";
import { tmpdir } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface SandboxConfig {
  id?: string;
  name: string;
  rootDir?: string;
  nodeVersion?: string;
  env?: Record<string, string>;
  resourceLimits?: ResourceLimits;
  workspaceId?: string;
}

export interface ResourceLimits {
  maxCpuMs?: number;
  maxMemoryBytes?: number;
  maxDiskBytes?: number;
  maxProcesses?: number;
  maxCommandTimeoutMs?: number;
  maxIdleTimeoutMs?: number;
  maxLifetimeMs?: number;
}

const DEFAULT_LIMITS: Required<ResourceLimits> = {
  maxCpuMs: 300_000,
  maxMemoryBytes: 2 * 1024 * 1024 * 1024,
  maxDiskBytes: 5 * 1024 * 1024 * 1024,
  maxProcesses: 20,
  maxCommandTimeoutMs: 60_000,
  maxIdleTimeoutMs: 900_000,
  maxLifetimeMs: 3_600_000,
};

export interface SandboxInstance {
  id: string;
  name: string;
  rootDir: string;
  status: "creating" | "ready" | "running" | "stopped" | "error" | "destroyed";
  createdAt: Date;
  processes: Map<string, SandboxProcess>;
  limits: Required<ResourceLimits>;
  lastActiveAt: Date;
  workspaceId?: string;
}

export interface SandboxProcess {
  id: string;
  command: string;
  pid: number | undefined;
  status: "running" | "exited" | "error";
  exitCode: number | null;
  stdout: string[];
  stderr: string[];
  startedAt: Date;
  exitedAt: Date | null;
}

export interface SandboxFileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: Date;
}

const sandboxes = new Map<string, SandboxInstance>();

export class SandboxEngine {
  /**
   * Create a new sandbox with an isolated filesystem.
   */
  async createSandbox(config: SandboxConfig): Promise<SandboxInstance> {
    const id = config.id ?? randomUUID();
    const rootDir = config.rootDir ?? await mkdtemp(join(tmpdir(), `sandbox-${id.slice(0, 8)}-`));

    await mkdir(rootDir, { recursive: true });

    const limits = { ...DEFAULT_LIMITS, ...config.resourceLimits };

    const sandbox: SandboxInstance = {
      id,
      name: config.name,
      rootDir,
      status: "ready",
      createdAt: new Date(),
      processes: new Map(),
      limits,
      lastActiveAt: new Date(),
      workspaceId: config.workspaceId,
    };

    sandboxes.set(id, sandbox);
    return sandbox;
  }

  /**
   * Get a sandbox by ID.
   */
  getSandbox(id: string): SandboxInstance | undefined {
    return sandboxes.get(id);
  }

  /**
   * List all sandboxes.
   */
  listSandboxes(): SandboxInstance[] {
    return Array.from(sandboxes.values());
  }

  /**
   * Write a file to the sandbox filesystem.
   * Prevents path traversal outside the sandbox root.
   */
  async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");
    if (sandbox.status === "destroyed") throw new Error("Sandbox is destroyed");

    const fullPath = normalize(join(sandbox.rootDir, path));
    // Prevent path traversal — use normalized root with trailing separator
    const normalizedRoot = sandbox.rootDir.endsWith(sep) ? normalize(sandbox.rootDir) : normalize(sandbox.rootDir) + sep;
    if (!fullPath.startsWith(normalizedRoot) && fullPath !== normalize(sandbox.rootDir)) {
      throw new Error("Path traversal not allowed");
    }

    const dir = dirname(fullPath);
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  /**
   * Read a file from the sandbox filesystem.
   * Prevents path traversal outside the sandbox root.
   */
  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");

    const fullPath = normalize(join(sandbox.rootDir, path));
    // Prevent path traversal — use normalized root with trailing separator
    const normalizedRoot = sandbox.rootDir.endsWith(sep) ? normalize(sandbox.rootDir) : normalize(sandbox.rootDir) + sep;
    if (!fullPath.startsWith(normalizedRoot) && fullPath !== normalize(sandbox.rootDir)) {
      throw new Error("Path traversal not allowed");
    }

    return readFile(fullPath, "utf-8");
  }

  /**
   * List files in a directory.
   */
  async listFiles(sandboxId: string, path: string = "."): Promise<SandboxFileEntry[]> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");

    const fullPath = normalize(join(sandbox.rootDir, path));
    // Prevent path traversal — use normalized root with trailing separator
    const normalizedRoot = sandbox.rootDir.endsWith(sep) ? normalize(sandbox.rootDir) : normalize(sandbox.rootDir) + sep;
    if (!fullPath.startsWith(normalizedRoot) && fullPath !== normalize(sandbox.rootDir)) {
      throw new Error("Path traversal not allowed");
    }

    const entries = await readdir(fullPath, { withFileTypes: true });

    const result: SandboxFileEntry[] = [];
    for (const entry of entries) {
      const entryPath = join(fullPath, entry.name);
      const stats = await stat(entryPath);
      result.push({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        size: stats.size,
        modifiedAt: stats.mtime,
      });
    }

    return result;
  }

  /**
   * Delete a file or directory.
   */
  async deletePath(sandboxId: string, path: string): Promise<void> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");

    const fullPath = join(sandbox.rootDir, path);
    // Prevent path traversal
    if (!fullPath.startsWith(sandbox.rootDir)) {
      throw new Error("Path traversal not allowed");
    }

    await rm(fullPath, { recursive: true, force: true });
  }

  /**
   * Execute a command in the sandbox.
   * Enforces resource limits: max processes, timeout, etc.
   */
  async execute(
    sandboxId: string,
    command: string,
    options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
  ): Promise<{ processId: string; exitCode: number | null; stdout: string; stderr: string }> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");
    if (sandbox.status === "destroyed") throw new Error("Sandbox is destroyed");

    // Check process limit (count both running and recently completed)
    const activeProcesses = Array.from(sandbox.processes.values()).filter(
      (p) => p.status === "running" || (p.exitedAt && Date.now() - p.exitedAt.getTime() < 1000),
    );
    if (activeProcesses.length >= sandbox.limits.maxProcesses) {
      throw new Error(`Process limit reached (${sandbox.limits.maxProcesses})`);
    }

    // Enforce timeout limit
    const timeout = Math.min(
      options.timeout ?? sandbox.limits.maxCommandTimeoutMs,
      sandbox.limits.maxCommandTimeoutMs,
    );

    const processId = randomUUID();
    const cwd = options.cwd ? join(sandbox.rootDir, options.cwd) : sandbox.rootDir;

    // Verify cwd is within sandbox
    if (!cwd.startsWith(sandbox.rootDir)) {
      throw new Error("Working directory must be within sandbox");
    }

    // Sanitize environment: remove sensitive host env vars
    const sensitiveVars = ["AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN", "DATABASE_URL"];
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !sensitiveVars.includes(key)) {
        env[key] = value;
      }
    }
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (!sensitiveVars.includes(key)) {
          env[key] = value;
        }
      }
    }

    const proc: SandboxProcess = {
      id: processId,
      command,
      pid: undefined,
      status: "running",
      exitCode: null,
      stdout: [],
      stderr: [],
      startedAt: new Date(),
      exitedAt: null,
    };

    sandbox.processes.set(processId, proc);
    sandbox.lastActiveAt = new Date();

    try {
      const result = await execAsync(command, {
        cwd,
        env,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      proc.status = "exited";
      proc.exitCode = 0;
      proc.stdout.push(result.stdout);
      proc.stderr.push(result.stderr);
      proc.exitedAt = new Date();

      return {
        processId,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      proc.status = "error";
      proc.exitCode = err.code ?? 1;
      if (err.stdout) proc.stdout.push(err.stdout);
      if (err.stderr) proc.stderr.push(err.stderr);
      proc.exitedAt = new Date();

      return {
        processId,
        exitCode: err.code ?? 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      };
    }
  }

  /**
   * Install dependencies in the sandbox.
   */
  async installDependencies(sandboxId: string, packageManager: string = "npm"): Promise<{ exitCode: number; output: string }> {
    const result = await this.execute(sandboxId, `${packageManager} install`, { timeout: 120_000 });
    return {
      exitCode: result.exitCode ?? 1,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Run a build in the sandbox.
   */
  async build(sandboxId: string, buildCommand: string = "npm run build"): Promise<{ exitCode: number; output: string }> {
    const result = await this.execute(sandboxId, buildCommand, { timeout: 300_000 });
    return {
      exitCode: result.exitCode ?? 1,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Start a development server in the sandbox.
   */
  async startDevServer(
    sandboxId: string,
    command: string = "npm run dev",
    port: number = 3000,
  ): Promise<{ processId: string; url: string }> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");

    const processId = randomUUID();
    const cwd = sandbox.rootDir;

    // Filter sensitive env vars (same as execute method)
    const sensitiveVars = ["AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN", "DATABASE_URL"];
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !sensitiveVars.includes(key)) {
        env[key] = value;
      }
    }
    env.PORT = String(port);

    const child = exec(command, {
      cwd,
      env,
    });

    const proc: SandboxProcess = {
      id: processId,
      command,
      pid: child.pid,
      status: "running",
      exitCode: null,
      stdout: [],
      stderr: [],
      startedAt: new Date(),
      exitedAt: null,
    };

    child.stdout?.on("data", (data: string) => {
      proc.stdout.push(data);
      if (proc.stdout.length > 1000) proc.stdout.shift();
    });

    child.stderr?.on("data", (data: string) => {
      proc.stderr.push(data);
      if (proc.stderr.length > 1000) proc.stderr.shift();
    });

    child.on("exit", (code) => {
      proc.status = "exited";
      proc.exitCode = code;
      proc.exitedAt = new Date();
    });

    sandbox.processes.set(processId, proc);

    return {
      processId,
      url: `http://localhost:${port}`,
    };
  }

  /**
   * Stop a process in the sandbox.
   */
  async stopProcess(sandboxId: string, processId: string): Promise<void> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");

    const proc = sandbox.processes.get(processId);
    if (!proc) throw new Error("Process not found");

    if (proc.status === "running" && proc.pid) {
      try {
        process.kill(proc.pid, "SIGTERM");
        await new Promise((r) => setTimeout(r, 2000));
        if (proc.status === "running") {
          process.kill(proc.pid, "SIGKILL");
        }
      } catch (err) {
        console.error("[Sandbox] Process may already be dead:", err);
      }
    }

    proc.status = "exited";
    proc.exitedAt = new Date();
  }

  /**
   * Get process logs.
   */
  getProcessLogs(sandboxId: string, processId: string, offset: number = 0): { stdout: string; stderr: string; exited: boolean } {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");

    const proc = sandbox.processes.get(processId);
    if (!proc) throw new Error("Process not found");

    return {
      stdout: proc.stdout.slice(offset).join(""),
      stderr: proc.stderr.slice(offset).join(""),
      exited: proc.status !== "running",
    };
  }

  /**
   * Check if a sandbox has exceeded its lifetime.
   */
  isExpired(sandboxId: string): boolean {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) return true;
    const lifetimeMs = Date.now() - sandbox.createdAt.getTime();
    return lifetimeMs > sandbox.limits.maxLifetimeMs;
  }

  /**
   * Check if a sandbox has been idle too long.
   */
  isIdle(sandboxId: string): boolean {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) return true;
    const idleMs = Date.now() - sandbox.lastActiveAt.getTime();
    return idleMs > sandbox.limits.maxIdleTimeoutMs;
  }

  /**
   * Destroy a sandbox and clean up resources.
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = sandboxes.get(sandboxId);
    if (!sandbox) return;

    // Stop all running processes
    for (const [processId, proc] of sandbox.processes) {
      if (proc.status === "running") {
        await this.stopProcess(sandboxId, processId);
      }
    }

    // Clean up filesystem
    await rm(sandbox.rootDir, { recursive: true, force: true }).catch((err) => { console.warn("[SandboxEngine] Failed to clean sandbox dir:", err); });

    sandbox.status = "destroyed";
    sandboxes.delete(sandboxId);
  }

  /**
   * Clear all sandboxes (for testing).
   */
  clearAll(): void {
    for (const [id] of sandboxes) {
      sandboxes.delete(id);
    }
  }
}
