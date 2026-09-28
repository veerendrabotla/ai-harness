import type {
  Project,
  Task,
  Session,
  Plan,
  PlanRejectResponse,
  PlanReviseResponse,
  ApprovalDecision,
  TaskEvent,
  Deployment,
  DeploymentDetails,
  MemoryEntry,
  Checkpoint,
  CheckpointRestoreResponse,
  HealthStatus,
} from "./types.js";

export interface SDKConfig {
  baseUrl: string;
  apiKey?: string;
  token?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
}

export class AiHarnessClient {
  private config: SDKConfig;

  constructor(config: SDKConfig) {
    this.config = { timeoutMs: 30_000, maxRetries: 3, ...config };
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, v);
      }
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const auth = this.config.apiKey || this.config.token;
    if (auth) headers["Authorization"] = `Bearer ${auth}`;

    const maxRetries = this.config.maxRetries!;
    let lastError: SDKError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs!);
      try {
        const res = await fetch(url.toString(), {
          method: options.method ?? "GET",
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const error = (await res.json().catch(() => ({ error: res.statusText }))) as Record<string, unknown>;
          const sdkError = new SDKError(String(error.error ?? res.statusText), res.status, error);
          if ([429, 502, 503].includes(res.status) && attempt < maxRetries) {
            const retryAfter = res.headers.get("Retry-After");
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(1000 * 2 ** attempt, 10_000);
            await new Promise((r) => setTimeout(r, delay));
            lastError = sdkError;
            continue;
          }
          throw sdkError;
        }

        const json = await res.json();
        return (json as { data?: T }).data ?? (json as T);
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof SDKError) throw err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10_000)));
          continue;
        }
        throw lastError ?? new SDKError(err instanceof Error ? err.message : String(err), 0);
      }
    }
    throw lastError!;
  }

  // Projects
  async listProjects(workspaceId: string): Promise<Project[]> {
    return this.request<Project[]>(`/v1/workspaces/${workspaceId}/projects`);
  }

  async createProject(workspaceId: string, data: { name: string; description?: string; rootReference?: string; connectionType?: string }): Promise<Project> {
    return this.request<Project>(`/v1/workspaces/${workspaceId}/projects`, { method: "POST", body: data });
  }

  // Tasks/Sessions
  async createTask(data: { goal: string; projectId?: string; workspaceId?: string; agentMode?: string }): Promise<Task> {
    return this.request<Task>("/v1/tasks", { method: "POST", body: data });
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}`);
  }

  async pauseTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}/pause`, { method: "POST" });
  }

  async resumeTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}/resume`, { method: "POST" });
  }

  async cancelTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}/cancel`, { method: "POST" });
  }

  // Sessions
  async listSessions(workspaceId: string): Promise<Session[]> {
    return this.request<Session[]>(`/v1/workspaces/${workspaceId}/sessions`);
  }

  // Plans
  async approvePlan(taskId: string, planId: string): Promise<Plan> {
    return this.request<Plan>(`/v1/tasks/${taskId}/plans/${planId}/approve`, { method: "POST" });
  }

  async rejectPlan(taskId: string, planId: string, reason: string): Promise<PlanRejectResponse> {
    return this.request<PlanRejectResponse>(`/v1/tasks/${taskId}/plans/${planId}/reject`, { method: "POST", body: { reason } });
  }

  async revisePlan(taskId: string, planId: string, instructions: string): Promise<PlanReviseResponse> {
    return this.request<PlanReviseResponse>(`/v1/tasks/${taskId}/plans/${planId}/revise`, { method: "POST", body: { instructions } });
  }

  // Approvals
  async approveTool(approvalId: string): Promise<ApprovalDecision> {
    return this.request<ApprovalDecision>(`/v1/approvals/${approvalId}/approve`, { method: "POST" });
  }

  async denyTool(approvalId: string, reason: string): Promise<ApprovalDecision> {
    return this.request<ApprovalDecision>(`/v1/approvals/${approvalId}/deny`, { method: "POST", body: { reason } });
  }

  // Events (streaming)
  async *streamEvents(taskId: string, pollIntervalMs = 1000, abortSignal?: AbortSignal): AsyncGenerator<TaskEvent> {
    const seen = new Set<string>();
    const deadline = Date.now() + 3_600_000; // 1 hour max
    while (Date.now() < deadline) {
      if (abortSignal?.aborted) return;
      const events = await this.request<TaskEvent[]>(`/v1/tasks/${taskId}/events`);
      for (const event of events) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          yield event;
        }
      }
      const task = await this.request<{ state: string }>(`/v1/tasks/${taskId}`);
      if (["COMPLETED", "FAILED", "CANCELLED", "PAUSED"].includes(task.state)) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, pollIntervalMs);
        abortSignal?.addEventListener("abort", () => { clearTimeout(timer); resolve(undefined); }, { once: true });
      });
    }
  }

  // Deployments
  async createDeployment(projectId: string, data: { provider: string; environment?: string }): Promise<Deployment> {
    return this.request<Deployment>(`/v1/projects/${projectId}/deploy`, { method: "POST", body: data });
  }

  async getDeployment(projectId: string, deploymentId: string): Promise<DeploymentDetails> {
    return this.request<DeploymentDetails>(`/v1/projects/${projectId}/deployments/${deploymentId}`);
  }

  // Memory
  async queryMemory(projectId: string, query: string): Promise<MemoryEntry[]> {
    return this.request<MemoryEntry[]>(`/v1/projects/${projectId}/memory`, { query: { q: query } });
  }

  async addMemory(projectId: string, data: { content: string; category: string }): Promise<MemoryEntry> {
    return this.request<MemoryEntry>(`/v1/projects/${projectId}/memory`, { method: "POST", body: data });
  }

  // Checkpoints
  async listCheckpoints(taskId: string): Promise<Checkpoint[]> {
    return this.request<Checkpoint[]>(`/v1/tasks/${taskId}/checkpoints`);
  }

  async restoreCheckpoint(checkpointId: string): Promise<CheckpointRestoreResponse> {
    return this.request<CheckpointRestoreResponse>(`/v1/checkpoints/${checkpointId}/restore`, { method: "POST", body: { confirm: true } });
  }

  // Health
  async health(): Promise<HealthStatus> {
    return this.request<HealthStatus>("/v1/health");
  }

  async retryTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}/retry`, { method: "POST" });
  }
  async updateTask(taskId: string, data: { goal: string }): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}`, { method: "PATCH", body: data });
  }
  async listTaskRuns(taskId: string): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>(`/v1/tasks/${taskId}/runs`);
  }
  async listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    return this.request<TaskEvent[]>(`/v1/tasks/${taskId}/events`);
  }
  async listDeployments(projectId: string): Promise<DeploymentDetails[]> {
    return this.request<DeploymentDetails[]>(`/v1/projects/${projectId}/deployments`);
  }
  async cancelDeployment(projectId: string, deploymentId: string): Promise<void> {
    await this.request(`/v1/projects/${projectId}/deployments/${deploymentId}/cancel`, { method: "POST" });
  }
  async rollbackDeployment(projectId: string, deploymentId: string): Promise<Deployment> {
    return this.request<Deployment>(`/v1/projects/${projectId}/deployments/${deploymentId}/rollback`, { method: "POST" });
  }
  async getDeploymentLogs(projectId: string, deploymentId: string, stream = "build"): Promise<{ logs: string }> {
    return this.request(`/v1/projects/${projectId}/deployments/${deploymentId}/logs`, { query: { stream } });
  }
  async listWorkspaces(): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>("/v1/workspaces");
  }
  async searchTasks(query: string, workspaceId?: string): Promise<Task[]> {
    return this.request<Task[]>("/v1/tasks/search", { method: "POST", body: { query, workspaceId } });
  }
}

export class SDKError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "SDKError";
    this.status = status;
    this.body = body;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SDKError);
    }
  }
}
