import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  DockerContainerConfig,
  DockerContainerInfo,
  DockerExecResult,
  DockerProcessHandle,
  DockerHealthCheck,
  DockerContainerStats,
} from "./docker-types.js";
import { DEFAULT_DOCKER_IMAGE, DEFAULT_RESOURCE_LIMITS } from "./docker-types.js";

// execFile with an args array never invokes a shell, so docker invocations are
// safe on Windows (cmd.exe would otherwise split on `&` and mangle quoting).
const execFileAsync = promisify(execFile);

const DOCKER_AVAILABLE_CACHE_TTL_MS = 30_000;
let dockerAvailableCache: { available: boolean; checkedAt: number } | null = null;

export class DockerSandboxEngine {
  private containers = new Map<string, DockerContainerInfo>();
  private processes = new Map<string, Map<string, DockerProcessHandle>>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupLoop();
  }

  private startCleanupLoop(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredContainers();
    }, 60_000);
  }

  async isDockerAvailable(): Promise<boolean> {
    if (dockerAvailableCache && Date.now() - dockerAvailableCache.checkedAt < DOCKER_AVAILABLE_CACHE_TTL_MS) {
      return dockerAvailableCache.available;
    }
    try {
      await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 5000 });
      dockerAvailableCache = { available: true, checkedAt: Date.now() };
      return true;
    } catch (err) {
      console.error("[Docker] Docker info check failed:", err);
      dockerAvailableCache = { available: false, checkedAt: Date.now() };
      return false;
    }
  }

  async createContainer(config: DockerContainerConfig): Promise<DockerContainerInfo> {
    const available = await this.isDockerAvailable();
    if (!available) {
      throw new Error("Docker daemon is not available. Ensure Docker is installed and running.");
    }

    const id = randomUUID();
    const name = config.name || `aiharness-sandbox-${id.slice(0, 8)}`;
    const image = config.image || DEFAULT_DOCKER_IMAGE;
    const workspaceDir = config.workspaceDir || join(tmpdir(), "aiharness-sandbox", id);
    const limits = { ...DEFAULT_RESOURCE_LIMITS, ...config.resourceLimits };

    await mkdir(workspaceDir, { recursive: true });

    const runArgs: string[] = [
      "run", "-d",
      "--name", name,
      "--label", `aiharness.sandbox.id=${id}`,
      "--label", "aiharness.sandbox=true",
      "--rm",
      "--network", config.networkMode || "bridge",
    ];

    if (limits.maxMemoryBytes) {
      runArgs.push("--memory", `${Math.floor(limits.maxMemoryBytes / (1024 * 1024))}m`);
    }

    // runc needs pid headroom to start `docker exec` processes: on Docker
    // Desktop (Windows) limits below ~16 intermittently fail execs with
    // "procReady not received" once background children/zombies accumulate,
    // which would make the sandbox non-executable. Verified: 16 stays reliable
    // under fork storms (pids capped at 15, execs succeed).
    const MIN_PIDS_LIMIT = 16;
    const requestedPids = config.pidsLimit ?? limits.maxProcesses ?? 20;
    runArgs.push("--pids-limit", String(Math.max(requestedPids, MIN_PIDS_LIMIT)));

    if (limits.maxCpuMs) {
      const cpuPeriod = config.cpuPeriod || 100_000;
      const cpuQuota = config.cpuQuota || Math.floor(limits.maxCpuMs / 10);
      runArgs.push("--cpu-period", String(cpuPeriod));
      runArgs.push("--cpu-quota", String(cpuQuota));
    }

    runArgs.push("-v", `${workspaceDir}:/workspace`);
    runArgs.push("-w", config.workingDir || "/workspace");

    const env = config.env || {};
    for (const [key, value] of Object.entries(env)) {
      if (!this.isSensitiveEnvVar(key)) {
        runArgs.push("-e", `${key}=${value}`);
      }
    }
    runArgs.push("-e", "HOME=/root");
    runArgs.push("-e", "NODE_ENV=development");

    if (config.readonlyRootfs) {
      runArgs.push("--read-only");
      runArgs.push("--tmpfs", "/tmp:size=256m");
      runArgs.push("--tmpfs", "/root/.npm:size=128m");
    }

    if (config.capDrop && config.capDrop.length > 0) {
      // docker expects one --cap-drop flag per capability; a comma-joined
      // list is rejected as a single unknown capability name.
      for (const cap of config.capDrop) {
        const normalized = cap.toUpperCase().startsWith("CAP_") ? cap.toUpperCase() : `CAP_${cap.toUpperCase()}`;
        runArgs.push("--cap-drop", normalized);
      }
    }

    if (config.securityOpt && config.securityOpt.length > 0) {
      for (const opt of config.securityOpt) {
        runArgs.push("--security-opt", opt);
      }
    }

    for (const vol of config.volumes || []) {
      runArgs.push("-v", `${vol.hostPath}:${vol.containerPath}${vol.readOnly ? ":ro" : ""}`);
    }

    runArgs.push(image);
    runArgs.push("sh", "-c", "trap '' TERM; sleep infinity & wait $!");

    try {
      const { stdout } = await execFileAsync("docker", runArgs, { timeout: 120_000 });
      const containerId = stdout.trim().slice(0, 12);

      const containerInfo: DockerContainerInfo = {
        id: containerId,
        name,
        image,
        state: "running",
        status: "created",
        created: new Date().toISOString(),
        ports: [],
        mounts: [{ type: "bind", source: workspaceDir, destination: "/workspace", rw: true }],
        resourceLimits: limits,
      };

      // Key every lookup by the docker id (what containerInfo.id exposes and
      // what all engine methods receive from callers); the UUID is only used
      // for the label and workspace directory.
      this.containers.set(containerId, containerInfo);
      this.processes.set(containerId, new Map());

      const lifetimeMs = limits.maxLifetimeMs || 3_600_000;
      const lifetimeTimer = setTimeout(() => {
        void this.destroyContainer(containerId);
      }, lifetimeMs);
      this.timers.set(`lifetime-${containerId}`, lifetimeTimer as ReturnType<typeof setInterval>);

      const idleMs = limits.maxIdleTimeoutMs || 900_000;
      const idleTimer = setInterval(() => {
        void this.checkIdleAndDestroy(containerId, idleMs);
      }, Math.min(idleMs, 60_000));
      this.timers.set(`idle-${containerId}`, idleTimer);

      return containerInfo;
    } catch (err) {
      await rm(workspaceDir, { recursive: true, force: true }).catch((err) => { console.warn("[DockerEngine] Failed to clean workspace dir:", err); });
      throw new Error(`Failed to create Docker container: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getContainer(id: string): DockerContainerInfo | undefined {
    return this.containers.get(id);
  }

  listContainers(): DockerContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /**
   * runc can intermittently fail the exec handshake ("procReady not received",
   * exit 128) before any process starts — the command never ran, so retrying
   * is safe and prevents flakes on Docker Desktop (Windows).
   */
  private async execFileWithHandshakeRetry(
    args: string[],
    opts: { timeout: number }
  ): Promise<{ stdout: string; stderr: string }> {
    const MAX_HANDSHAKE_RETRIES = 2;
    const HANDSHAKE_MARKER = /procReady|unable to start container process|OCI runtime exec failed/;
    let attempt = 0;
    for (;;) {
      try {
        return await execFileAsync("docker", args, opts);
      } catch (err) {
        // Docker CLI (v29) writes this failure to stdout; exit code is 128.
        const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
        const stream = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
        if (e.code === 128 && HANDSHAKE_MARKER.test(stream) && attempt < MAX_HANDSHAKE_RETRIES) {
          attempt += 1;
          await new Promise((r) => setTimeout(r, 150 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  async executeInContainer(
    containerId: string,
    command: string,
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
      captureOutput?: boolean;
    }
  ): Promise<DockerExecResult> {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);
    if (container.state !== "running") throw new Error(`Container ${containerId} is not running`);

    const timeout = options?.timeout || container.resourceLimits.maxCommandTimeoutMs || 60_000;
    const start = Date.now();

    const execArgs: string[] = ["exec"];
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (!this.isSensitiveEnvVar(key)) {
          execArgs.push("-e", `${key}=${value}`);
        }
      }
    }
    if (options?.cwd) {
      execArgs.push("--workdir", options.cwd);
    }
    execArgs.push(container.id, "sh", "-c", command);

    // runc can intermittently fail the exec handshake ("procReady not
    // received", exit 128) before any process starts — retried in
    // execFileWithHandshakeRetry.
    try {
      const { stdout, stderr } = await this.execFileWithHandshakeRetry(execArgs, { timeout });
      const duration = Date.now() - start;
      return { exitCode: 0, stdout, stderr, duration };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      const duration = Date.now() - start;
      return {
        exitCode: e.code ?? 1,
        stdout: e.stdout ?? "",
        stderr: String(e.stderr ?? e.message ?? ""),
        duration,
      };
    }
  }

  async startProcess(
    containerId: string,
    command: string,
    options?: { cwd?: string; env?: Record<string, string> }
  ): Promise<DockerProcessHandle> {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);
    if (container.state !== "running") throw new Error(`Container ${containerId} is not running`);

    const processId = randomUUID();
    const execArgs: string[] = ["exec", "-d"];
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (!this.isSensitiveEnvVar(key)) {
          execArgs.push("-e", `${key}=${value}`);
        }
      }
    }
    if (options?.cwd) {
      execArgs.push("--workdir", options.cwd);
    }
    execArgs.push(container.id, "sh", "-c", command);

    const { stdout } = await this.execFileWithHandshakeRetry(execArgs, { timeout: 10_000 }).catch(() => ({
      stdout: "",
      stderr: "",
    }));

    const pid = parseInt(stdout.trim()) || 0;
    const handle: DockerProcessHandle = {
      id: processId,
      containerId,
      command,
      pid,
      startedAt: new Date(),
      status: "running",
    };

    const containerProcesses = this.processes.get(containerId) || new Map();
    containerProcesses.set(processId, handle);
    this.processes.set(containerId, containerProcesses);

    return handle;
  }

  async stopContainer(id: string, timeoutMs = 10_000): Promise<void> {
    const container = this.containers.get(id);
    if (!container) return;

    try {
      await execFileAsync("docker", ["stop", "--time", String(Math.floor(timeoutMs / 1000)), container.id], { timeout: timeoutMs + 5000 });
    } catch (err) {
      console.error("[Docker] Failed to stop container:", err);
    }

    container.state = "stopped";
    this.clearTimers(id);
  }

  async destroyContainer(id: string): Promise<void> {
    const container = this.containers.get(id);
    if (!container) return;

    try {
      await execFileAsync("docker", ["rm", "-f", container.id], { timeout: 10_000 });
    } catch (err) {
      console.error("[Docker] Failed to remove container:", err);
    }

    const containerProcesses = this.processes.get(id);
    if (containerProcesses) {
      for (const [, handle] of containerProcesses) {
        handle.status = "exited";
      }
    }

    this.clearTimers(id);
    this.containers.delete(id);
    this.processes.delete(id);
  }

  async getContainerStats(id: string): Promise<DockerContainerStats | null> {
    const container = this.containers.get(id);
    if (!container) return null;

    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["stats", container.id, "--no-stream", "--format", "{{json .}}"],
        { timeout: 10_000 }
      );
      const stats = JSON.parse(stdout.trim());
      return {
        cpuUsage: parseFloat(stats.CPUPerc) || 0,
        memoryUsage: this.parseSizeBytes(stats.MemUsage?.split("/")[0]?.trim() || "0"),
        memoryLimit: this.parseSizeBytes(stats.MemUsage?.split("/")[1]?.trim() || "0"),
        networkRx: this.parseSizeBytes(stats.NetIO?.split("/")[0]?.trim() || "0"),
        networkTx: this.parseSizeBytes(stats.NetIO?.split("/")[1]?.trim() || "0"),
        blockIoRead: this.parseSizeBytes(stats.BlockIO?.split("/")[0]?.trim() || "0"),
        blockIoWrite: this.parseSizeBytes(stats.BlockIO?.split("/")[1]?.trim() || "0"),
        pidsCurrent: parseInt(stats.PIDs) || 0,
      };
    } catch (err) {
      console.error("[Docker] Failed to get container stats:", err);
      return null;
    }
  }

  async healthCheck(id: string): Promise<DockerHealthCheck> {
    const container = this.containers.get(id);
    if (!container) {
      return { status: "unhealthy", failingStreak: 1, output: "Container not found", lastChecked: new Date() };
    }

    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["inspect", "--format", "{{json .State.Health}}", container.id],
        { timeout: 5000 }
      );
      const health = JSON.parse(stdout.trim()) as {
        Status?: string;
        FailingStreak?: number;
        Log?: Array<{ Output?: string }>;
      } | null;
      // `null` = no HEALTHCHECK configured → fall through to the state-based fallback.
      if (!health) throw new Error("no health check configured");
      return {
        status: health.Status === "healthy" ? "healthy" : health.Status === "starting" ? "starting" : "unhealthy",
        failingStreak: health.FailingStreak || 0,
        output: health.Log?.[0]?.Output || "No health check configured",
        lastChecked: new Date(),
      };
    } catch (err) {
      console.error("[Docker] Health check inspect failed:", err);
      const isRunning = container.state === "running";
      return {
        status: isRunning ? "healthy" : "unhealthy",
        failingStreak: isRunning ? 0 : 1,
        output: isRunning ? "Container is running" : "Container is not running",
        lastChecked: new Date(),
      };
    }
  }

  async waitForContainer(id: string, timeoutMs = 60_000): Promise<boolean> {
    const container = this.containers.get(id);
    if (!container) return false;

    try {
      await execFileAsync(
        "docker",
        ["wait", container.id],
        { timeout: timeoutMs }
      );
      container.state = "exited";
      return true;
    } catch (err) {
      console.error("[Docker] Failed to wait for container:", err);
      return false;
    }
  }

  private async checkIdleAndDestroy(id: string, idleTimeoutMs: number): Promise<void> {
    const container = this.containers.get(id);
    if (!container || container.state !== "running") return;

    const containerProcesses = this.processes.get(id);
    if (containerProcesses) {
      for (const handle of containerProcesses.values()) {
        if (handle.status === "running") return;
      }
    }

    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.State.StartedAt}}", container.id],
      { timeout: 5000 }
    ).catch(() => ({ stdout: "" }));

    if (stdout) {
      const startedAt = new Date(stdout.trim()).getTime();
      if (Date.now() - startedAt > idleTimeoutMs) {
        await this.destroyContainer(id);
      }
    }
  }

  private async cleanupExpiredContainers(): Promise<void> {
    for (const [id, container] of this.containers) {
      if (container.state === "stopped" || container.state === "error") {
        await this.destroyContainer(id);
      }
    }
  }

  private clearTimers(id: string): void {
    for (const [key, timer] of this.timers) {
      if (key.includes(id)) {
        clearInterval(timer);
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }
  }

  private isSensitiveEnvVar(key: string): boolean {
    const sensitivePatterns = [
      /SECRET/i, /TOKEN/i, /PASSWORD/i, /KEY/i,
      /AWS_/i, /GITHUB_/i, /DATABASE_URL/i, /NPM_TOKEN/i,
      /PRIVATE/i, /CREDENTIAL/i, /AUTH/i,
    ];
    return sensitivePatterns.some((p) => p.test(key));
  }

  private parseSizeBytes(sizeStr: string): number {
    const match = sizeStr.match(/([\d.]+)\s*(B|KiB|MiB|GiB|TiB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1] || "0");
    const unit = (match[2] || "B").toLowerCase();
    switch (unit) {
      case "b": return value;
      case "kib": return value * 1024;
      case "mib": return value * 1024 * 1024;
      case "gib": return value * 1024 * 1024 * 1024;
      case "tib": return value * 1024 * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  async clearAll(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    // Actually remove the containers from the host — clearing only the
    // in-memory map would orphan every container as a running leak.
    await Promise.all([...this.containers.keys()].map((id) => this.destroyContainer(id)));
    this.containers.clear();
    this.processes.clear();
  }
}
