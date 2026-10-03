export interface Project {
  id: string;
  workspaceId: string;
  bridgeId: string | null;
  name: string;
  connectionType: string;
  repositoryUrl: string | null;
  rootReference: string;
  defaultBranch: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  goal: string;
  constraints: string | null;
  state: string;
  agentMode: "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX";
  selectedModelMode: "MANUAL" | "ROUTED";
  overrideProviderConnectionId: string | null;
  overrideModelIdentifier: string | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  viewerRole?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  acceptanceCriteria: string[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export interface Plan {
  id: string;
  taskId: string;
  runId: string;
  version: number;
  analysis: string;
  affectedFiles: string[];
  steps: PlanStep[];
  risks: string[];
  verificationPlan: Array<{ command: string; asserts: string[] }>;
  status: "DRAFT" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface PlanRejectResponse {
  success: boolean;
  taskState: string;
}

export interface PlanReviseResponse {
  success: boolean;
}

export interface ApprovalDecision {
  id: string;
  status: "APPROVED" | "DENIED";
}

export interface TaskEvent {
  id: string;
  taskId: string;
  runId: string | null;
  sequenceNumber: number;
  eventType: string;
  actorType: "USER" | "SYSTEM" | "AGENT" | "TOOL" | "BRIDGE";
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface Deployment {
  deploymentId: string;
  status: string;
}

export interface DeploymentDetails {
  id: string;
  projectId: string;
  taskId: string | null;
  checkpointId: string | null;
  status: string;
  environment: string;
  buildCommand: string | null;
  deploymentUrl: string | null;
  previewUrl: string | null;
  buildLogs: string | null;
  runtimeLogs: string | null;
  failureReason: string | null;
  sourceRevision: string | null;
  sourceBranch: string | null;
  startedAt: string | null;
  buildCompletedAt: string | null;
  deployedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DeploymentLogResponse {
  deploymentId: string;
  stream: string;
  logs: string;
  totalLines: number;
}

export interface MemoryEntry {
  id: string;
  projectId: string;
  category: string;
  key: string;
  value: string;
  context: string;
  confidence: number;
  source: string;
  references: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  id: string;
  taskId: string;
  projectId: string;
  checkpointType: "PRE_EXECUTION" | "MANUAL";
  stateReference: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface CheckpointRestoreResponse {
  rolledBackTo: string;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  checks: Record<string, string>;
}

export interface Session {
  id: string;
  projectId: string;
  workspaceId: string;
  title: string;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SDKErrorResponse {
  error: string;
  status: number;
  body?: unknown;
}

export interface ListResponse<T> {
  data: T[];
  requestId?: string;
}
