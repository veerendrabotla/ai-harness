/**
 * Execution Provider Interface.
 * Abstraction layer that allows the agent to execute operations
 * regardless of whether the project runs locally or in the cloud.
 *
 *                  ExecutionProvider
 *                         │
 *          ┌──────────────┼──────────────┐
 *          ↓              ↓              ↓
 *     Local Bridge    Docker Sandbox    WebContainer
 *          ↓              ↓              ↓
 *  User's Computer  Container Runtime  Browser Runtime
 */

export type ProviderType = "local_bridge" | "cloud_sandbox" | "docker" | "webcontainer" | "remote";

export interface ExecutionProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly status: "connected" | "disconnected" | "error";

  // ── Filesystem ──────────────────────────────────────────
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  listFiles(path: string): Promise<FileEntry[]>;
  mkdir(path: string): Promise<void>;

  // ── Execution ───────────────────────────────────────────
  execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
  startProcess(command: string, options?: StartProcessOptions): Promise<ProcessHandle>;
  stopProcess(processId: string): Promise<void>;
  getProcessLogs(processId: string, offset?: number): Promise<ProcessLogs>;

  // ── Git ─────────────────────────────────────────────────
  gitCommit(message: string): Promise<string>;
  gitLog(limit?: number): Promise<GitCommit[]>;
  gitDiff(): Promise<string>;

  // ── Preview ─────────────────────────────────────────────
  startPreview(command: string, port: number): Promise<PreviewHandle>;
  stopPreview(): Promise<void>;
  getPreviewStatus(): Promise<PreviewStatus>;

  // ── Lifecycle ───────────────────────────────────────────
  destroy(): Promise<void>;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: Date;
}

export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  captureOutput?: boolean;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface StartProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface ProcessHandle {
  id: string;
  pid: number | undefined;
  command: string;
  startedAt: Date;
}

export interface ProcessLogs {
  stdout: string;
  stderr: string;
  exited: boolean;
  exitCode: number | null;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export interface PreviewHandle {
  url: string;
  processId: string;
}

export interface PreviewStatus {
  active: boolean;
  url: string | null;
  processId: string | null;
}

// ── Provider Configuration ────────────────────────────────

export interface ProviderConfig {
  type: ProviderType;
  projectId: string;
  workspaceId: string;
  // Local Bridge config
  bridgeId?: string;
  rootReference?: string;
  // Cloud Sandbox config
  sandboxId?: string;
  sandboxName?: string;
  // Docker config
  dockerImage?: string;
  dockerNetworkMode?: "bridge" | "host" | "none" | string;
  dockerVolumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  dockerReadonlyRootfs?: boolean;
  dockerCapDrop?: string[];
  // WebContainer config
  webcontainerTemplate?: string;
  webcontainerApiKey?: string;
  // Resource limits
  resourceLimits?: ResourceLimits;
}

export interface ResourceLimits {
  maxCpuMs?: number;
  maxMemoryBytes?: number;
  maxDiskBytes?: number;
  maxProcesses?: number;
  maxCommandTimeoutMs?: number;
  maxIdleTimeoutMs?: number;
  maxLifetimeMs?: number;
  allowedNetworkHosts?: string[];
}

// ── Provider Factory ──────────────────────────────────────

export interface ExecutionProviderFactory {
  create(config: ProviderConfig): Promise<ExecutionProvider>;
  destroy(providerId: string): Promise<void>;
}
