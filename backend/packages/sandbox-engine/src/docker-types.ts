import type { ResourceLimits } from "./engine.js";

export interface DockerContainerConfig {
  name: string;
  image?: string;
  workspaceDir?: string;
  resourceLimits?: Partial<ResourceLimits>;
  env?: Record<string, string>;
  networkMode?: "bridge" | "host" | "none" | string;
  volumes?: DockerVolumeMount[];
  workingDir?: string;
  cpuPeriod?: number;
  cpuQuota?: number;
  memory?: string;
  pidsLimit?: number;
  diskQuota?: string;
  readonlyRootfs?: boolean;
  capDrop?: string[];
  securityOpt?: string[];
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxLifetimeMs?: number;
}

export interface DockerVolumeMount {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: string;
  ports: DockerPortMapping[];
  mounts: DockerMountInfo[];
  resourceLimits: ResourceLimits;
}

export interface DockerPortMapping {
  hostPort: number;
  containerPort: number;
  protocol: "tcp" | "udp";
}

export interface DockerMountInfo {
  type: "bind" | "volume" | "tmpfs";
  source: string;
  destination: string;
  rw: boolean;
}

export interface DockerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface DockerProcessHandle {
  id: string;
  containerId: string;
  command: string;
  pid: number;
  startedAt: Date;
  status: "running" | "exited" | "error";
}

export interface DockerHealthCheck {
  status: "healthy" | "unhealthy" | "starting";
  failingStreak: number;
  output: string;
  lastChecked: Date;
}

export interface DockerContainerStats {
  cpuUsage: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  blockIoRead: number;
  blockIoWrite: number;
  pidsCurrent: number;
}

export const DEFAULT_DOCKER_IMAGE = "node:20-slim";

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxCpuMs: 300_000,
  maxMemoryBytes: 2 * 1024 * 1024 * 1024,
  maxDiskBytes: 5 * 1024 * 1024 * 1024,
  maxProcesses: 20,
  maxCommandTimeoutMs: 60_000,
  maxIdleTimeoutMs: 900_000,
  maxLifetimeMs: 3_600_000,
};
