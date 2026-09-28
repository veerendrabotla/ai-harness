export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "waiting";
export type TaskPriority = "critical" | "high" | "medium" | "low";
export type ExecutionMode = "sequential" | "parallel" | "pipeline";

export interface OrchestratorTask {
  id: string;
  name: string;
  status: TaskStatus;
  priority: TaskPriority;
  dependencies: string[];
  result?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ExecutionPlan {
  id: string;
  name: string;
  mode: ExecutionMode;
  tasks: OrchestratorTask[];
  createdAt: Date;
}

export interface OrchestrationResult {
  planId: string;
  completedTasks: string[];
  failedTasks: string[];
  duration: number;
  success: boolean;
}
