import type { ProjectMemory, MemoryCategory, MemoryQuery, MemoryInsight, MemoryStats } from "@ai-harness/project-memory";
import type { Conflict, ConflictType, ResolutionStrategy, ConflictDetectionResult } from "@ai-harness/conflict-resolution";

export interface EngineConfig {
  prisma: unknown;
  logger: unknown;
  onEvent?: (taskId: string, event: EngineEvent) => void;
}

export interface Engine {
  createTask(input: CreateTaskInput): Promise<TaskHandle>;
  resumeTask(taskId: string, userId: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  cancelTask(taskId: string, userId: string): Promise<void>;
  retryTask(taskId: string): Promise<void>;
  approvePlan(taskId: string, userId: string): Promise<void>;
  rejectPlan(taskId: string, userId: string, reason: string): Promise<void>;
  revisePlan(taskId: string, userId: string, instructions: string): Promise<void>;
  approveTool(taskId: string, approvalId: string, userId: string): Promise<void>;
  denyTool(taskId: string, approvalId: string, userId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskSnapshot | null>;
  getRun(taskId: string, runId: string): Promise<RunSnapshot | null>;
  subscribe(taskId: string, callback: (event: EngineEvent) => void): Unsubscribe;

  createCheckpoint(taskId: string, label: string): Promise<CheckpointSnapshot>;
  rollbackToCheckpoint(checkpointId: string, userId: string): Promise<void>;
  listCheckpoints(taskId: string): Promise<CheckpointSnapshot[]>;

  queryMemory(projectId: string, query: Omit<MemoryQuery, "projectId">): Promise<MemoryInsight[]>;
  addMemory(projectId: string, category: MemoryCategory, content: string, metadata?: Record<string, unknown>): Promise<ProjectMemory>;
  getMemoryStats(projectId: string): Promise<MemoryStats>;

  detectConflict(filePath: string, currentContent: string, incomingContent: string, type?: ConflictType): ConflictDetectionResult;
  resolveConflict(conflictId: string, strategy: ResolutionStrategy, resolvedBy: string, manualContent?: string): Promise<void>;
  getUnresolvedConflicts(): Conflict[];

  listModels(): Promise<ModelInfo[]>;
  setModelOverride(taskId: string, model: ModelOverride): Promise<void>;

  getEventHistory(taskId: string): Promise<EngineEvent[]>;

  dispose(): Promise<void>;
}

export interface TaskHandle {
  taskId: string;
  state: string;
}

export interface TaskSnapshot {
  id: string;
  goal: string;
  state: string;
  projectId: string;
  workspaceId: string;
  runs: RunSnapshot[];
  plans: PlanSnapshot[];
}

export interface RunSnapshot {
  id: string;
  state: string;
  agentMode: string;
  startedAt: string;
  completedAt?: string;
}

export interface PlanSnapshot {
  id: string;
  status: string;
  version: number;
  steps: PlanStepSnapshot[];
}

export interface PlanStepSnapshot {
  id: string;
  description: string;
  status: string;
}

export interface CreateTaskInput {
  goal: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  agentMode?: "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX";
  modelOverride?: { providerConnectionId: string; modelIdentifier: string };
  config?: Record<string, unknown>;
}

export interface Unsubscribe {
  (): void;
}

export interface EngineEvent {
  type: string;
  taskId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface CheckpointSnapshot {
  id: string;
  taskId: string;
  projectId: string;
  type: string;
  label?: string;
  createdAt: string;
}

export interface ModelInfo {
  provider: string;
  model: string;
  maxTokens: number;
}

export interface ModelOverride {
  providerConnectionId: string;
  modelIdentifier: string;
}
