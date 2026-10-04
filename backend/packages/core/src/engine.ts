import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@ai-harness/shared";
import { buildAgentRuntime } from "@ai-harness/agent-runtime";
import { ConflictResolutionEngine } from "@ai-harness/conflict-resolution";
import type { ProjectMemory, MemoryCategory, MemoryQuery, MemoryInsight, MemoryStats } from "@ai-harness/project-memory";
import type { Conflict, ConflictType, ResolutionStrategy, ConflictDetectionResult } from "@ai-harness/conflict-resolution";
import type {
  Engine,
  EngineConfig,
  TaskHandle,
  TaskSnapshot,
  RunSnapshot,
  CreateTaskInput,
  EngineEvent,
  Unsubscribe,
  CheckpointSnapshot,
  ModelInfo,
  ModelOverride,
} from "./types.js";

export function createEngine(config: EngineConfig): Engine {
  const prisma = config.prisma as PrismaClient;
  const logger = config.logger as Logger;

  const runtime = buildAgentRuntime({
    prisma,
    logger,
    onTaskEvent: config.onEvent ? (taskId: string, event: unknown) => {
      config.onEvent!(taskId, event as EngineEvent);
    } : undefined,
  });

  const conflictEngine = new ConflictResolutionEngine();
  const subscriptions = new Map<string, Set<(event: EngineEvent) => void>>();
  const eventHistory = new Map<string, EngineEvent[]>();

  const publishEvent = (taskId: string, event: EngineEvent) => {
    if (!eventHistory.has(taskId)) eventHistory.set(taskId, []);
    if (eventHistory.size > 1000) {
      const keys = Array.from(eventHistory.keys());
      for (let i = 0; i < Math.min(200, keys.length); i++) {
        const key = keys[i];
        if (key !== undefined) eventHistory.delete(key);
      }
    }
    eventHistory.get(taskId)!.push(event);
    const subs = subscriptions.get(taskId);
    if (subs) {
      for (const cb of subs) {
        try { cb(event); } catch (err) { console.error("[Engine] Subscriber error:", err); }
      }
    }
    config.onEvent?.(taskId, event);
  };

  return {
    async createTask(input: CreateTaskInput): Promise<TaskHandle> {
      const taskId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const outcome = await runtime.multiAgentOrchestrator.startRun({
        taskId,
        runId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        goal: input.goal,
        constraints: null,
        agentMode: input.agentMode ?? "BUILD",
        selectedModelMode: "ROUTED",
        modelOverride: input.modelOverride ?? null,
        workspaceInstructionVersion: null,
        policySnapshotId: "",
      });

      const stateMap: Record<string, string> = {
        COMPLETED: "COMPLETED",
        FAILED: "FAILED",
        CANCELLED: "CANCELLED",
        RUNNING: "RUNNING",
        AWAITING_PLAN_APPROVAL: "AWAITING_PLAN_APPROVAL",
        AWAITING_TOOL_APPROVAL: "AWAITING_TOOL_APPROVAL",
      };
      const state = stateMap[outcome] ?? "RUNNING";
      publishEvent(taskId, {
        type: "TASK_CREATED",
        taskId,
        timestamp: new Date().toISOString(),
        data: { goal: input.goal, projectId: input.projectId, state },
      });

      return { taskId, state };
    },

    async resumeTask(taskId: string, userId: string): Promise<void> {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new Error(`Task ${taskId} not found`);
      await runtime.orchestrator.approvePlanAndExecute({ taskId, userId });
    },

    async pauseTask(taskId: string): Promise<void> {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new Error(`Task ${taskId} not found`);
      await prisma.task.update({
        where: { id: taskId },
        data: { pauseRequested: true },
      });
      publishEvent(taskId, {
        type: "TASK_PAUSED",
        taskId,
        timestamp: new Date().toISOString(),
        data: {},
      });
    },

    async cancelTask(taskId: string, userId: string): Promise<void> {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new Error(`Task ${taskId} not found`);
      await prisma.task.update({
        where: { id: taskId },
        data: { cancelRequested: true },
      });
      publishEvent(taskId, {
        type: "TASK_CANCELLED",
        taskId,
        timestamp: new Date().toISOString(),
        data: { userId },
      });
    },

    async retryTask(taskId: string): Promise<void> {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new Error(`Task ${taskId} not found`);
      await prisma.task.update({
        where: { id: taskId },
        data: { state: "QUEUED" },
      });
      await runtime.multiAgentOrchestrator.startRun({
        taskId,
        runId: crypto.randomUUID(),
        projectId: task.projectId,
        workspaceId: task.workspaceId,
        userId: task.createdBy,
        goal: task.goal,
        constraints: task.constraints,
        agentMode: task.agentMode ?? "BUILD",
        selectedModelMode: task.selectedModelMode ?? "ROUTED",
        modelOverride: task.overrideProviderConnectionId && task.overrideModelIdentifier
          ? { providerConnectionId: task.overrideProviderConnectionId, modelIdentifier: task.overrideModelIdentifier }
          : null,
        workspaceInstructionVersion: null,
        policySnapshotId: "",
      });
      publishEvent(taskId, {
        type: "TASK_RETRIED",
        taskId,
        timestamp: new Date().toISOString(),
        data: {},
      });
    },

    async approvePlan(taskId: string, userId: string): Promise<void> {
      await runtime.orchestrator.approvePlanAndExecute({ taskId, userId });
    },

    async rejectPlan(taskId: string, userId: string, reason: string): Promise<void> {
      const plan = await prisma.taskPlan.findFirst({
        where: { taskId, status: "DRAFT" },
        orderBy: { version: "desc" },
      });
      if (!plan) throw new Error(`No draft plan found for task ${taskId}`);
      await prisma.taskPlan.update({
        where: { id: plan.id },
        data: { status: "REJECTED", approvedBy: userId },
      });
      publishEvent(taskId, {
        type: "PLAN_REJECTED",
        taskId,
        timestamp: new Date().toISOString(),
        data: { planId: plan.id, reason },
      });
    },

    async revisePlan(taskId: string, userId: string, instructions: string): Promise<void> {
      await runtime.orchestrator.revisePlan({ taskId, userId, instruction: instructions });
    },

    async approveTool(taskId: string, approvalId: string, userId: string): Promise<void> {
      try {
        await runtime.approvals.resolve({ approvalId, userId, approved: true });
      } catch (err) {
        // An expired approval behaves like a denial: still resume the run so
        // it can replan instead of hanging in WAITING_FOR_TOOL_APPROVAL.
        if ((err as { code?: string }).code !== "APPROVAL_EXPIRED") throw err;
      }
      await runtime.orchestrator.continueAfterToolDecision({ taskId });
    },

    async denyTool(taskId: string, approvalId: string, userId: string): Promise<void> {
      try {
        await runtime.approvals.resolve({ approvalId, userId, approved: false });
      } catch (err) {
        if ((err as { code?: string }).code !== "APPROVAL_EXPIRED") throw err;
      }
      await runtime.orchestrator.continueAfterToolDecision({ taskId });
    },

    async getTask(taskId: string): Promise<TaskSnapshot | null> {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { runs: true },
      });
      if (!task) return null;
      const plans = await prisma.taskPlan.findMany({
        where: { taskId },
        orderBy: { version: "desc" },
        take: 1,
      });
      return {
        id: task.id,
        goal: task.goal,
        state: task.state,
        projectId: task.projectId,
        workspaceId: task.workspaceId,
        runs: task.runs.map((r) => ({
          id: r.id,
          state: r.state,
          agentMode: task.agentMode,
          startedAt: (r.startedAt ?? task.createdAt).toISOString(),
          completedAt: r.endedAt?.toISOString(),
        })),
        plans: plans.map((p) => ({
          id: p.id,
          status: p.status,
          version: p.version,
          steps: (p.steps as unknown[] ?? []).map((s) => {
            const step = s as { id?: string; description?: string; status?: string };
            return { id: step.id!, description: step.description!, status: step.status! };
          }),
        })),
      };
    },

    async getRun(taskId: string, runId: string): Promise<RunSnapshot | null> {
      const run = await prisma.taskRun.findUnique({ where: { id: runId } });
      if (!run || run.taskId !== taskId) return null;
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { agentMode: true, createdAt: true } });
      return {
        id: run.id,
        state: run.state,
        agentMode: task?.agentMode ?? "BUILD",
        startedAt: (run.startedAt ?? task?.createdAt ?? new Date()).toISOString(),
        completedAt: run.endedAt?.toISOString(),
      };
    },

    subscribe(taskId: string, callback: (event: EngineEvent) => void): Unsubscribe {
      if (!subscriptions.has(taskId)) subscriptions.set(taskId, new Set());
      subscriptions.get(taskId)!.add(callback);
      return () => { subscriptions.get(taskId)?.delete(callback); };
    },

    async createCheckpoint(taskId: string, label: string): Promise<CheckpointSnapshot> {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
      if (!task) throw new Error(`Task ${taskId} not found`);

      const result = await runtime.checkpoints.tryCreatePreExecution({
        taskId,
        runId: crypto.randomUUID(),
        projectId: task.projectId,
      });

      if (!result.created) {
        throw new Error(`Checkpoint creation failed: ${result.reason}`);
      }

      const checkpoint = await prisma.checkpoint.findUnique({ where: { id: result.checkpointId! } });
      if (!checkpoint) throw new Error("Checkpoint created but not found");

      const snapshot: CheckpointSnapshot = {
        id: checkpoint.id,
        taskId,
        projectId: task.projectId,
        type: checkpoint.checkpointType,
        label,
        createdAt: checkpoint.createdAt.toISOString(),
      };

      publishEvent(taskId, {
        type: "CHECKPOINT_CREATED",
        taskId,
        timestamp: new Date().toISOString(),
        data: { checkpointId: checkpoint.id, label },
      });

      return snapshot;
    },

    async rollbackToCheckpoint(checkpointId: string, userId: string): Promise<void> {
      const checkpoint = await prisma.checkpoint.findUnique({ where: { id: checkpointId } });
      if (!checkpoint) throw new Error(`Checkpoint ${checkpointId} not found`);

      await runtime.checkpoints.rollback({ checkpointId, userId });

      publishEvent(checkpoint.taskId, {
        type: "CHECKPOINT_ROLLED_BACK",
        taskId: checkpoint.taskId,
        timestamp: new Date().toISOString(),
        data: { checkpointId, userId },
      });
    },

    async listCheckpoints(taskId: string): Promise<CheckpointSnapshot[]> {
      const checkpoints = await prisma.checkpoint.findMany({
        where: { taskId },
        orderBy: { createdAt: "desc" },
      });
      return checkpoints.map((c) => ({
        id: c.id,
        taskId: c.taskId,
        projectId: c.projectId,
        type: c.checkpointType,
        createdAt: c.createdAt.toISOString(),
      }));
    },

    async queryMemory(projectId: string, query: Omit<MemoryQuery, "projectId">): Promise<MemoryInsight[]> {
      return runtime.memoryEngine.getRelevant(projectId, query.keywords?.join(" ") ?? "", query.limit);
    },

    async addMemory(projectId: string, category: MemoryCategory, content: string, metadata?: Record<string, unknown>): Promise<ProjectMemory> {
      return runtime.memoryEngine.remember(projectId, {
        projectId,
        category,
        key: metadata?.key as string ?? content.slice(0, 100),
        value: content,
        context: metadata?.context as string ?? "",
        confidence: (metadata?.confidence as number) ?? 0.5,
        source: (metadata?.source as "agent_observation" | "user_input" | "code_analysis" | "error_pattern") ?? "user_input",
        references: (metadata?.references as string[]) ?? [],
      });
    },

    async getMemoryStats(projectId: string): Promise<MemoryStats> {
      return runtime.memoryEngine.stats(projectId);
    },

    detectConflict(filePath: string, currentContent: string, incomingContent: string, type: ConflictType = "file"): ConflictDetectionResult {
      return conflictEngine.detectConflict(filePath, currentContent, incomingContent, type);
    },

    async resolveConflict(conflictId: string, strategy: ResolutionStrategy, resolvedBy: string, manualContent?: string): Promise<void> {
      await conflictEngine.resolve(conflictId, strategy, resolvedBy, manualContent);
    },

    getUnresolvedConflicts(): Conflict[] {
      return conflictEngine.getUnresolvedConflicts();
    },

    async listModels(): Promise<ModelInfo[]> {
      return runtime.adapters.list().map((adapter) => ({
        provider: adapter.providerType,
        model: "default",
        maxTokens: 4096,
      }));
    },

    async setModelOverride(taskId: string, model: ModelOverride): Promise<void> {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new Error(`Task ${taskId} not found`);
      await prisma.task.update({
        where: { id: taskId },
        data: {
          overrideProviderConnectionId: model.providerConnectionId,
          overrideModelIdentifier: model.modelIdentifier,
        },
      });
      publishEvent(taskId, {
        type: "MODEL_OVERRIDE_SET",
        taskId,
        timestamp: new Date().toISOString(),
        data: { model },
      });
    },

    async getEventHistory(taskId: string): Promise<EngineEvent[]> {
      return eventHistory.get(taskId) ?? [];
    },

    async dispose(): Promise<void> {
      if (runtime && typeof runtime === "object" && "dispose" in runtime) {
        await (runtime as { dispose: () => Promise<void> }).dispose();
      }
      subscriptions.clear();
      eventHistory.clear();
    },
  };
}
