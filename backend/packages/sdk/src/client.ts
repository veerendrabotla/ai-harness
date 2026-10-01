import type {
  Project,
  Task,
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
          const envelope = error.error;
          const message =
            envelope && typeof envelope === "object" && "message" in envelope
              ? String((envelope as { message: unknown }).message)
              : typeof envelope === "string"
                ? envelope
                : res.statusText || `HTTP ${res.status}`;
          const code =
            envelope && typeof envelope === "object" && "code" in envelope
              ? String((envelope as { code: unknown }).code)
              : undefined;
          const sdkError = new SDKError(message, res.status, error, code);
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
  async createTask(data: {
    goal: string;
    projectId: string;
    workspaceId?: string;
    agentMode?: string;
    constraints?: string;
  }): Promise<Task> {
    let workspaceId = data.workspaceId;
    if (!workspaceId) {
      if (!data.projectId) {
        throw new SDKError("createTask requires a projectId (tasks must belong to a project)", 400);
      }
      const project = await this.request<{ workspaceId: string }>(`/v1/projects/${data.projectId}`);
      workspaceId = project.workspaceId;
    }
    return this.request<Task>("/v1/tasks", { method: "POST", body: { ...data, workspaceId } });
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

  // Sessions (tasks ARE sessions in this architecture)
  async listTasks(workspaceId: string, opts: { state?: string; limit?: number } = {}): Promise<Task[]> {
    const query: Record<string, string> = { workspaceId };
    if (opts.state) query.state = opts.state;
    if (opts.limit !== undefined) query.limit = String(opts.limit);
    return this.request<Task[]>("/v1/tasks", { query });
  }

  // Plans
  async approvePlan(taskId: string, planId: string): Promise<Plan> {
    return this.request<Plan>(`/v1/tasks/${taskId}/plans/${planId}/approve`, { method: "POST" });
  }

  async rejectPlan(taskId: string, planId: string, reason: string): Promise<PlanRejectResponse> {
    return this.request<PlanRejectResponse>(`/v1/tasks/${taskId}/plans/${planId}/reject`, { method: "POST", body: { reason } });
  }

  async revisePlan(taskId: string, planId: string, instruction: string): Promise<PlanReviseResponse> {
    return this.request<PlanReviseResponse>(`/v1/tasks/${taskId}/plans/${planId}/revise`, { method: "POST", body: { instruction } });
  }

  // Approvals
  async approveTool(approvalId: string): Promise<ApprovalDecision> {
    return this.request<ApprovalDecision>(`/v1/approvals/${approvalId}/approve`, { method: "POST" });
  }

  async denyTool(approvalId: string, reason: string): Promise<ApprovalDecision> {
    return this.request<ApprovalDecision>(`/v1/approvals/${approvalId}/deny`, { method: "POST", body: { reason } });
  }

  // Events (streaming) — incremental via afterSequence, stops on terminal state
  async *streamEvents(taskId: string, pollIntervalMs = 1000, abortSignal?: AbortSignal): AsyncGenerator<TaskEvent> {
    const deadline = Date.now() + 3_600_000; // 1 hour max
    let afterSequence: number | undefined;
    while (Date.now() < deadline) {
      if (abortSignal?.aborted) return;
      for (;;) {
        const query: Record<string, string> = { limit: "200" };
        if (afterSequence !== undefined) query.afterSequence = String(afterSequence);
        const page = await this.request<TaskEvent[]>(`/v1/tasks/${taskId}/events`, { query });
        if (page.length === 0) break;
        for (const event of page) {
          yield event;
          if (typeof event.sequenceNumber === "number") afterSequence = event.sequenceNumber;
        }
        if (page.length < 200) break;
      }
      const task = await this.request<{ state: string }>(`/v1/tasks/${taskId}`);
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(task.state)) break;
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
    const res = await this.request<{ memories: MemoryEntry[] }>(`/v1/projects/${projectId}/memories`, { query: { q: query } });
    return res.memories ?? [];
  }

  async addMemory(
    projectId: string,
    data: {
      category: string;
      key: string;
      value: string;
      context: string;
      confidence?: number;
      source?: string;
      references?: string[];
    },
  ): Promise<MemoryEntry> {
    return this.request<MemoryEntry>(`/v1/projects/${projectId}/memories`, { method: "POST", body: data });
  }

  // Checkpoints
  async listCheckpoints(taskId: string): Promise<Checkpoint[]> {
    return this.request<Checkpoint[]>(`/v1/tasks/${taskId}/checkpoints`);
  }

  async rollbackCheckpoint(checkpointId: string): Promise<CheckpointRestoreResponse> {
    return this.request<CheckpointRestoreResponse>(`/v1/checkpoints/${checkpointId}/rollback`, { method: "POST", body: { confirm: true } });
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
  code?: string;
  constructor(message: string, status: number, body?: unknown, code?: string) {
    super(message);
    this.name = "SDKError";
    this.status = status;
    this.body = body;
    this.code = code;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SDKError);
    }
  }
}
