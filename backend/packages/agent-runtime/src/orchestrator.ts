import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import type { Task } from "@prisma/client";
import type { Logger } from "@ai-harness/shared";
import { AppError, errors, redactValue } from "@ai-harness/shared";
import {
  DEFAULT_RUN_BOUNDS,
  FAILURE_CODES,
  TASK_EVENT_TYPES,
  isActiveRunState,
  isTerminalState,
  type RunBounds,
  type TaskState,
} from "@ai-harness/domain";
import type { PlanDraft, PlanStep } from "@ai-harness/contracts";
import { buildPolicySnapshot, evaluatePermission, type PolicySnapshot } from "@ai-harness/permission-engine";
import { assembleContext, estimateTokens } from "@ai-harness/context-engine";
import { ToolHarness, ToolRegistry, type ExecutionEnvironment } from "@ai-harness/tool-harness";
import { AdapterError, extractJson, ModelAdapterRegistry, type ModelRequest } from "@ai-harness/model-adapters";
import { SelfRecoveryEngine } from "@ai-harness/self-recovery";
import { z } from "zod";
import { EventPublisher } from "./event-publisher.js";
import { TaskStateService } from "./state-service.js";
import { Planner, RUNTIME_SYSTEM_INSTRUCTIONS, persistNewPlanVersion } from "./planner.js";
import { ModelRouter } from "./model-router.js";
import { ApprovalCoordinator } from "./approval-coordinator.js";
import { CheckpointManager } from "./checkpoint-manager.js";
import { VerificationEngine } from "./verification-engine.js";
import type { RunInput } from "./run-input.js";
import { analyzeRepository, type RepoAnalysis } from "@ai-harness/repo-intelligence";
import type { TraceBuilder, TracePersistence } from "@ai-harness/agent-observability";
import type { ExtensionRegistry, ToolExtension } from "@ai-harness/extension-system";
import type { SessionEngine } from "@ai-harness/session-engine";
import type { CodeSearch } from "@ai-harness/code-search";
import type { FileWatcher } from "@ai-harness/file-watcher";
import type { MCPRegistry } from "@ai-harness/mcp-platform";

/** Lifecycle hook events — compact version of Claude Code's 27-event taxonomy. */
export type HookEvent =
  | "beforePlan"
  | "afterPlan"
  | "beforeToolCall"
  | "afterToolCall"
  | "onToolError"
  | "beforeVerification"
  | "afterVerification"
  | "beforeComplete"
  | "afterComplete"
  | "onReplan"
  | "onError";

export interface HookContext {
  taskId: string;
  runId: string;
  projectId: string;
  workspaceId: string;
  event: HookEvent;
  payload?: Record<string, unknown>;
}

export type HookHandler = (ctx: HookContext) => Promise<void> | void;

export type RunOutcome =
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "AWAITING_PLAN_APPROVAL"
  | "AWAITING_TOOL_APPROVAL"
  | "INTERRUPTED";

interface Budget extends RunBounds {
  toolCallsUsed: number;
  modelInvocationsUsed: number;
  replansUsed: number;
}

/**
 * Task Orchestrator (AGENT_RUNTIME.md §2).
 * Owns the run lifecycle, prevents concurrent active runs and drives:
 * understand -> gather context -> plan -> (approval) -> execute loop ->
 * observe -> replan (bounded) -> verify -> complete.
 */
export class TaskOrchestrator {
  private readonly state: TaskStateService;
  private readonly recovery: SelfRecoveryEngine;
  private activeSessionId: string | null = null;
  private readonly hooks = new Map<HookEvent, HookHandler[]>();

  /** Register a lifecycle hook. Mirrors Claude Code's hook taxonomy. */
  onHook(event: HookEvent, handler: HookHandler): void {
    const list = this.hooks.get(event) ?? [];
    list.push(handler);
    this.hooks.set(event, list);
  }

  /** Remove a previously registered hook. */
  offHook(event: HookEvent, handler: HookHandler): void {
    const list = this.hooks.get(event);
    if (!list) return;
    this.hooks.set(event, list.filter((h) => h !== handler));
  }

  private async fireHooks(event: HookEvent, ctx: Omit<HookContext, "event">): Promise<void> {
    const handlers = this.hooks.get(event);
    if (!handlers?.length) return;
    for (const h of handlers) {
      try {
        await h({ ...ctx, event });
      } catch (err) {
        this.logger.warn({ err, event, taskId: ctx.taskId }, "lifecycle hook failed");
      }
    }
  }

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly events: EventPublisher,
    private readonly planner: Planner,
    private readonly router: ModelRouter,
    private readonly approvals: ApprovalCoordinator,
    private readonly checkpoints: CheckpointManager,
    private readonly verification: VerificationEngine,
    private readonly adapters: ModelAdapterRegistry,
    private readonly tools: ToolRegistry,
    private readonly harness: ToolHarness,
    private readonly control?: {
      register(taskId: string): AbortSignal;
      signal(taskId: string): AbortSignal | undefined;
      release(taskId: string): void;
    },
    private readonly traceBuilder?: TraceBuilder,
    private readonly tracePersistence?: TracePersistence,
    private readonly extensionRegistry?: ExtensionRegistry,
    private readonly sessionEngine?: SessionEngine,
    private readonly codeSearch?: CodeSearch,
    private readonly fileWatcher?: FileWatcher,
    private readonly mcpRegistry?: MCPRegistry,
  ) {
    this.state = new TaskStateService(prisma, (i) => this.events.publishAndEmit(i));
    this.recovery = new SelfRecoveryEngine();
  }

  // ── Entry points ────────────────────────────────────────────

  /** Starts a queued task. Creates the run row and drives the full lifecycle. */
  async startRun(input: RunInput): Promise<RunOutcome> {
    const ctx = await this.loadContext(input);
    // Backfill the authoritative policy snapshot id (callers construct RunInput before the policy is resolved).
    input.policySnapshotId = ctx.snapshot.policyId;

    if (ctx.workspace.status === "ARCHIVED") {
      await this.cancelFromState(input.taskId, input.userId, ctx.task.state, "WORKSPACE_ARCHIVED");
      return "CANCELLED";
    }
    if (ctx.project.status !== "AVAILABLE") {
      await this.cancelFromState(input.taskId, input.userId, ctx.task.state, "PROJECT_UNAVAILABLE");
      return "CANCELLED";
    }

    // Register abort signal for external cancellation
    const abortSignal = this.control?.register(input.taskId);

    const created = await this.state.createRunExclusively(input.taskId, input.runId || randomUUID());
    const run = { id: created.id, runNumber: created.runNumber };

    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: run.id,
      eventType: TASK_EVENT_TYPES.RUN_STARTED,
      actorType: "SYSTEM",
      payload: { runNumber: run.runNumber },
    });
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: run.id,
      eventType: TASK_EVENT_TYPES.POLICY_SNAPSHOT_RECORDED,
      actorType: "SYSTEM",
      payload: { policySnapshotId: ctx.snapshot.policyId, capturedAt: ctx.snapshot.capturedAt },
    });

    let state = await this.state.transition({
      taskId: input.taskId,
      runId: run.id,
      from: "QUEUED",
      to: "INITIALIZING",
    });

    // Create a session to persist run state
    await this.createRunSession(input, run.id).catch((err) => {
      this.logger.warn({ err, taskId: input.taskId }, "Failed to create session for run");
    });

    const budget = await this.buildRunBudget(ctx, run.id);
    const deadline = Date.now() + budget.maxDurationMs;

    // Start observability trace
    const traceId = this.traceBuilder?.startTrace(input.taskId, run.id, input.goal);

    try {
      state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "UNDERSTANDING" });

      state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "GATHERING_CONTEXT" });
      await this.buildAndPersistContext(input, run.id);

      // ── Agent Mode Branching ──────────────────────────────
      const mode = input.agentMode ?? "BUILD";

      if (mode === "ASK") {
        // ASK mode: provide analysis/answer, no tool execution
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "PLANNING" });
        const outcome = await this.planOnce(input, run.id, ctx, budget, deadline, undefined, undefined, traceId);
        if (outcome !== "PROCEED") return this.outcomeOf(outcome);
        // Skip execution — go straight to completing
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: "PLANNING", to: "VERIFYING" });
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "REVIEWING" });
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "COMPLETED" });
        return "COMPLETED";
      }

      if (mode === "REVIEW") {
        // REVIEW mode: inspect code and produce findings, no mutations
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "REVIEWING" });
        await this.runReview(input, run.id, [], [], traceId);
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "COMPLETED" });
        return "COMPLETED";
      }

      if (mode === "PLAN") {
        // PLAN mode: create plan, always require approval, stop
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "PLANNING" });
        const outcome = await this.planOnce(input, run.id, ctx, budget, deadline, undefined, "plan", traceId);
        // planOnce will set WAITING_FOR_APPROVAL if requirePlanApproval is true
        // In PLAN mode we always require approval
        if (outcome === "PROCEED") {
          // Force approval requirement
          state = await this.state.transition({
            taskId: input.taskId, runId: run.id, from: "PLANNING", to: "WAITING_FOR_APPROVAL",
            reason: "PLAN mode: awaiting plan approval before execution",
          });
        }
        return this.outcomeOf(outcome);
      }

      // BUILD and FIX modes: full lifecycle
      // Approved plan from a resumed (paused/interrupted) earlier run?
      const approvedPlanRow = await this.latestApprovedPlan(input.taskId);
      state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "PLANNING" });

      if (!approvedPlanRow) {
        const outcome = await this.planOnce(input, run.id, ctx, budget, deadline, undefined, undefined, traceId);
        if (outcome !== "PROCEED") return this.outcomeOf(outcome);
        state = await this.state.transition({ taskId: input.taskId, runId: run.id, from: state, to: "EXECUTING" });
      } else {
        state = await this.state.transition({
          taskId: input.taskId, runId: run.id, from: state, to: "EXECUTING",
          reason: "Resuming with previously approved plan",
        });
      }

      return await this.executionLoop(input, run.id, ctx, budget, deadline, abortSignal, traceId);
    } catch (err) {
      return this.handleStageFailure(input, run.id, state, err);
    }
  }

  /** Continues execution after a human approves the pending plan. */
  async approvePlanAndExecute(input: { taskId: string; userId: string }): Promise<RunOutcome> {
    const task = await this.prisma.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw errors.notFound("Task");
    if (task.state !== "WAITING_FOR_APPROVAL") {
      throw errors.conflict(`Cannot approve a plan while task is ${task.state}`);
    }
    // The API records the human decision BEFORE enqueuing this continuation,
    // so the plan is already APPROVED at this point.
    const plan = await this.latestApprovedPlan(input.taskId);
    if (!plan) throw errors.notFound("Approved plan");

    await this.prisma.taskPlan.update({
      where: { id: plan.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: input.userId },
    });
    await this.recordAudit(input.userId, task.workspaceId, "PLAN_APPROVED", plan.id);

    const run = await this.currentRunOrThrow(input.taskId);
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: run.id,
      eventType: TASK_EVENT_TYPES.PLAN_APPROVED,
      actorType: "USER",
      payload: { planId: plan.id, version: plan.version },
    });
    await this.state.transition({
      taskId: input.taskId, runId: run.id,
      from: "WAITING_FOR_APPROVAL", to: "EXECUTING",
      actorType: "USER", reason: "Plan approved",
    });

    // Clean up orphaned tool calls from previous crash
    await this.cleanupOrphanedToolCalls(input.taskId, run.id);

    const ctx = await this.loadContextFromTask(task);
    const budget = await this.buildRunBudget(ctx, run.id);
    try {
      return await this.executionLoop(
        { ...this.toRunInput(task), runId: run.id },
        run.id, ctx, budget, Date.now() + budget.maxDurationMs,
      );
    } catch (err) {
      const fresh = await this.prisma.task.findUnique({ where: { id: input.taskId }, select: { state: true } });
      if (!fresh) throw errors.notFound("Task");
      const from = (fresh.state as TaskState) ?? "EXECUTING";
      if (isTerminalState(from)) return this.outcomeOf(from as RunOutcome);
      return this.handleStageFailure(this.toRunInput(task), run.id, from, err);
    }
  }

  /** Regenerates the plan after the user requests revision (APP_FLOW §7). */
  async revisePlan(input: { taskId: string; userId: string; instruction: string }): Promise<RunOutcome> {
    const task = await this.prisma.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw errors.notFound("Task");
    if (task.state !== "WAITING_FOR_APPROVAL") {
      throw errors.conflict(`Cannot request revision while task is ${task.state}`);
    }
    const run = await this.currentRunOrThrow(input.taskId);
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: run.id,
      eventType: TASK_EVENT_TYPES.PLAN_REVISION_REQUESTED,
      actorType: "USER",
      payload: { instruction: input.instruction, requestedBy: input.userId },
    });
    await this.state.transition({
      taskId: input.taskId, runId: run.id,
      from: "WAITING_FOR_APPROVAL", to: "PLANNING",
      actorType: "USER", reason: "Revision requested",
    });

    const ctx = await this.loadContextFromTask(task);
    const budget = await this.buildRunBudget(ctx, run.id);

    try {
      const outcome = await this.planOnce(this.toRunInput(task), run.id, ctx, budget, Date.now() + budget.maxDurationMs, input.instruction);
      return this.outcomeOf(outcome);
    } catch (err) {
      return this.handleStageFailure(this.toRunInput(task), run.id, "PLANNING", err);
    }
  }

  /** Continues the loop after a tool approval decision. */
  async continueAfterToolDecision(input: { taskId: string }): Promise<RunOutcome> {
    const task = await this.prisma.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw errors.notFound("Task");
    if (task.state !== "WAITING_FOR_TOOL_APPROVAL") {
      throw errors.conflict(`Task is ${task.state}, expected WAITING_FOR_TOOL_APPROVAL`);
    }
    const run = await this.currentRunOrThrow(input.taskId);
    await this.state.transition({
      taskId: input.taskId, runId: run.id,
      from: "WAITING_FOR_TOOL_APPROVAL", to: "EXECUTING",
      reason: "Approval decision applied",
    });

    // Clean up orphaned tool calls from previous crash
    await this.cleanupOrphanedToolCalls(input.taskId, run.id);

    const ctx = await this.loadContextFromTask(task);
    const budget = await this.buildRunBudget(ctx, run.id);
    try {
      return await this.executionLoop(
        this.toRunInput(task), run.id, ctx, budget, Date.now() + budget.maxDurationMs,
      );
    } catch (err) {
      return this.handleStageFailure(this.toRunInput(task), run.id, "EXECUTING", err);
    }
  }

  // ── Planning ────────────────────────────────────────────────

  private async planOnce(
    input: RunInput,
    runId: string,
    ctx: RunContext,
    budget: Budget,
    deadline: number,
    revisionInstruction?: string,
    mode?: "ask" | "plan",
    traceId?: string,
  ): Promise<"PROCEED" | RunOutcome> {
    await this.fireHooks("beforePlan", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { mode: mode ?? input.agentMode } });
    this.assertBudget(budget, deadline);
    // If the effective mode is REVIEW/ASK ensure planning instructions are read-only regardless of stale snapshot
    const effectiveMode = (mode === "ask" ? "ASK" : mode === "plan" ? "PLAN" : input.agentMode) as string | undefined;
    if ((effectiveMode === "REVIEW" || effectiveMode === "ASK") && ctx.instructions && !ctx.instructions.includes("read-only")) {
      ctx = { ...ctx, instructions: `${ctx.instructions}\n\n[MODE CONSTRAINT: ${effectiveMode} mode is read-only — do not propose or execute mutations; provide analysis / answers only.]` };
    }

    const routes = await this.router.resolveWithFallbacks({
      userId: input.userId,
      workspaceId: input.workspaceId,
      stage: "PLANNING",
      override: input.modelOverride ?? undefined,
    });
    const route = routes[0]!;
    const adapter = this.adapters.require(route.providerConnection.providerType);
    budget.modelInvocationsUsed += 1;

    const previousPlan = revisionInstruction ? await this.latestPlanAny(input.taskId) : null;

    const fallbackRoutes = routes.slice(1);
    const draft = await this.planner.createPlan({
      taskId: input.taskId,
      runId,
      goal: input.goal,
      constraints: input.constraints,
      workspaceInstructions: ctx.instructions,
      adapter,
      route,
      fallbackRoutes,
      getAdapter: (t) => this.adapters.get(t),
      revisionInstruction: revisionInstruction ?? null,
      previousPlan,
      streamDeltas: true,
      onDelta: this.deltaPublisher(input.taskId, runId),
      publish: (p) => this.events.publishAndEmit(p),
    });

    const saved = await persistNewPlanVersion(this.prisma, {
      taskId: input.taskId,
      runId,
      plan: draft,
      supersedePrevious: true,
    });
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId,
      eventType: TASK_EVENT_TYPES.PLAN_CREATED,
      actorType: "AGENT",
      payload: { planId: saved.id, version: saved.version, stepCount: draft.steps.length },
    });

    // Persist plan to session
    await this.recordPlanToSession(draft.analysis).catch((err) => {
      this.logger.warn({ err }, "Failed to record plan to session");
    });

    await this.fireHooks("afterPlan", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { planId: saved.id, version: saved.version, stepCount: draft.steps.length } });

    // Record plan in observability trace
    if (traceId) {
      this.traceBuilder!.addReasoning(traceId, {
        thought: `Plan created with ${draft.steps.length} steps: ${draft.analysis.slice(0, 200)}`,
        context: draft.steps.map((s) => s.title),
        confidence: 0.85,
        sources: ["planner"],
      });
      for (const step of draft.steps) {
        this.traceBuilder!.addPlanStep(traceId, {
          action: step.title,
          rationale: step.detail,
          expectedOutcome: `Step ${step.id} completed`,
          riskLevel: step.toolName === "terminal" || step.toolName === "filesystem.write" ? "medium" : "low",
          dependencies: [],
          status: "pending",
        });
      }
    }

    // PLAN mode always requires approval
    if (mode === "plan" || ctx.snapshot.requirePlanApproval) {
      await this.state.transition({
        taskId: input.taskId, runId,
        from: "PLANNING", to: "WAITING_FOR_APPROVAL",
        reason: mode === "plan" ? "PLAN mode: awaiting plan approval" : "Workspace policy requires plan approval",
      });
      return "AWAITING_PLAN_APPROVAL";
    }
    if (!ctx.snapshot.allowDirectExecution) {
      // Policy demands neither approval nor direct execution: fail safe.
      throw new AppError("POLICY_DENIED", "Policy forbids both plan approval flow and direct execution");
    }
      // Auto-approve the internal plan and proceed (APP_FLOW §8).
    await this.prisma.taskPlan.update({
      where: { id: saved.id },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    await this.events.publishAndEmit({
      taskId: input.taskId, runId,
      eventType: TASK_EVENT_TYPES.PLAN_APPROVED,
      actorType: "SYSTEM",
      payload: { planId: saved.id, auto: true, basis: "allowDirectExecution" },
    });
    await this.state.transition({
      taskId: input.taskId, runId, from: "PLANNING", to: "EXECUTING",
      reason: "Direct execution permitted by workspace policy",
    });
    return "PROCEED";
  }

  // ── Execution loop ─────────────────────────────────────────

  private async executionLoop(
    input: RunInput,
    runId: string,
    ctx: RunContext,
    budget: Budget,
    deadline: number,
    abortSignal?: AbortSignal,
    traceId?: string,
  ): Promise<RunOutcome> {
    const planRow =
      (await this.latestApprovedPlan(input.taskId)) ??
      (() => { throw errors.conflict("Execution requires an approved plan"); })();

    const plan: PlanDraft = {
      analysis: planRow.analysis,
      assumptions: [],
      affectedFiles: (planRow.affectedFiles as string[]) ?? [],
      steps: (planRow.steps as PlanStep[]) ?? [],
      risks: (planRow.risks as string[]) ?? [],
      verificationPlan: (planRow.verificationPlan as Array<{ command: string }>) ?? [],
    };

    await this.checkpoints.tryCreatePreExecution({
      taskId: input.taskId, runId, projectId: input.projectId,
    });

    // ── Sync extension tools into ToolRegistry ──────────────────────────
    this.syncExtensionTools();

    // ── Resume reconciliation ────────────────────────────────────────────
    // The loop must be resumable across processes: an approved tool call may be
    // waiting for execution, or a denial may be waiting to trigger a replan.
    let startIndex = await this.resumeCursor(input.taskId, runId, plan.steps);

    const pendingApproved = await this.prisma.toolCall.findFirst({
      where: { taskId: input.taskId, runId, status: "PENDING" },
    });
    if (pendingApproved) {
      // Explicitly human-approved: executes regardless of static policy outcome.
      const summary = (pendingApproved.inputSummary ?? {}) as Record<string, unknown>;
      const stepId = typeof summary["stepId"] === "string" ? summary["stepId"] : "";
      const { stepId: _s, ...toolInput } = summary;
      // Mid-loop checkpoint before destructive tool execution (human-approved path)
      const pendingDef = this.tools.get(pendingApproved.toolName);
      if (pendingDef?.riskLevel === "DESTRUCTIVE") {
        await this.checkpoints
          .tryCreatePreStep({
            taskId: input.taskId,
            runId,
            projectId: input.projectId,
            toolName: pendingApproved.toolName,
            stepId: stepId || pendingApproved.id,
          })
          .catch((err) => {
            this.logger.warn({ err, toolName: pendingApproved.toolName, stepId }, "Failed to create pre-step checkpoint for destructive tool (pendingApproved)");
          });
      }
      await this.fireHooks("beforeToolCall", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { toolName: pendingApproved.toolName, toolCallId: pendingApproved.id, stepId } });
      const pendingStep = this.withProjectRoot(
        { id: stepId, title: "", detail: "", toolName: pendingApproved.toolName, toolInput },
        ctx,
      );
      const result = await this.runAllowedTool(
        input, runId, pendingApproved.id,
        pendingStep,
        budget,
        this.executionEnvironmentFor(pendingDef?.environment ?? "LOCAL_BRIDGE", ctx.project.connectionType),
      );
      await this.fireHooks(result.status === "SUCCEEDED" ? "afterToolCall" : "onToolError", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { toolName: pendingApproved.toolName, toolCallId: pendingApproved.id, status: result.status, failureCode: result.failureCode } });
      await this.events.publishAndEmit({
        taskId: input.taskId, runId,
        eventType: "TOOL_OBSERVED",
        actorType: "SYSTEM",
        payload: { toolCallId: pendingApproved.id, toolName: pendingApproved.toolName, observation: this.analyzeToolOutput(result, pendingApproved.toolName) },
      });
      const idx = plan.steps.findIndex((s) => s.id === stepId);
      startIndex = idx >= 0 ? idx + 1 : startIndex;
      if (result.status !== "SUCCEEDED") {
        const replanned = await this.replanAfterFailure(
          input, runId, ctx, budget,
          `Approved tool ${pendingApproved.toolName} failed (${result.failureCode}): ${result.failureMessage}`,
        );
        if (replanned !== "PROCEED") return this.outcomeOf(replanned);
        return this.executionLoop(input, runId, ctx, budget, deadline, undefined, traceId);
      }
    } else {
      const unhandledDenial = await this.latestUnhandledDenial(input.taskId, runId);
      if (unhandledDenial) {
        const replanned = await this.replanAfterFailure(
          input, runId, ctx, budget,
          `Human denied ${unhandledDenial}`,
        );
        if (replanned !== "PROCEED") return this.outcomeOf(replanned);
        return this.executionLoop(input, runId, ctx, budget, deadline, undefined, traceId);
      }
    }

    // Active TASK-scope approvals grant repeated ALLOW for the approved tool name
    // for the lifetime of the task (permission-engine §12 evaluation order).
    const taskScopeToolNames = await this.activeTaskScopeToolNames(input.taskId);

    for (const step of plan.steps.slice(startIndex)) {
      // Check external abort signal
      if (abortSignal?.aborted) {
        await this.state.failCancelled(input.taskId, runId, await this.getCurrentState(input.taskId));
        return "CANCELLED";
      }
      const control = await this.checkControlFlags(input.taskId, runId);
      if (control) return this.outcomeOf(control);
      this.assertBudget(budget, deadline);

      let effective = step;
      // Planning models sometimes emit free-form tool names (e.g. "Text Editor").
      // Treat unknown names like an omitted toolName — let the implementation
      // model PROPOSE the real tool — instead of failing the whole run.
      if (!effective.toolName || !this.tools.get(effective.toolName)) {
        // Reasoning step: give the implementation model a chance to PROPOSE a
        // tool action; proposals pass through the exact same permission gate.
        const proposal = await this.proposeNextAction(input, runId, ctx, budget, step, traceId);
        if (!proposal) continue;
        effective = { ...step, toolName: proposal.name, toolInput: proposal.input };
      }
      effective = this.withProjectRoot(effective, ctx);

      const definition = this.tools.get(effective.toolName!);
      if (!definition) {
        const replanned = await this.replanAfterFailure(
          input, runId, ctx, budget,
          `Step '${step.id}' references unknown tool ${effective.toolName}`,
        );
        if (replanned !== "PROCEED") return this.outcomeOf(replanned);
        return this.executionLoop(input, runId, ctx, budget, deadline, undefined, traceId);
      }
      const execEnvironment = this.executionEnvironmentFor(definition.environment, ctx.project.connectionType);

      const toolCall = await this.prisma.toolCall.create({
        data: {
          id: randomUUID(),
          taskId: input.taskId,
          runId,
          toolName: effective.toolName!,
          riskLevel: definition.riskLevel,
          inputSummary: redactValue({
            stepId: step.id,
            ...((effective.toolInput ?? {}) as Record<string, unknown>),
          }) as Prisma.InputJsonValue,
          status: "PENDING",
        },
      });

      const resourcePath = (() => {
        const input = (effective.toolInput ?? {}) as Record<string, unknown>;
        if (effective.toolName === "filesystem.write" || effective.toolName === "filesystem.create") {
          if (typeof input["path"] === "string") return input["path"] as string;
        }
        if (effective.toolName === "filesystem.rename" && typeof input["to"] === "string") return input["to"] as string;
        if (typeof input["path"] === "string") return input["path"] as string;
        return undefined;
      })();
      const decision = evaluatePermission(ctx.snapshot, {
        toolName: effective.toolName!,
        riskLevel: definition.riskLevel,
        resourcePath,
        approvals: { taskScopeToolNames },
      });
      budget.toolCallsUsed += 1;

      if (decision.outcome === "DENY") {
        await this.prisma.toolCall.update({
          where: { id: toolCall.id }, data: { status: "DENIED" },
        });
        await this.events.publishAndEmit({
          taskId: input.taskId, runId,
          eventType: TASK_EVENT_TYPES.TOOL_DENIED,
          actorType: "SYSTEM",
          payload: { toolCallId: toolCall.id, reason: decision.reason },
        });
        const replanned = await this.replanAfterFailure(
          input, runId, ctx, budget,
          `Permission denied for ${effective.toolName}: ${decision.reason}`,
        );
        if (replanned !== "PROCEED") return this.outcomeOf(replanned);
        return this.executionLoop(input, runId, ctx, budget, deadline, undefined, traceId);
      }

      if (decision.outcome === "ASK") {
        await this.prisma.toolCall.update({
          where: { id: toolCall.id }, data: { status: "WAITING_APPROVAL" },
        });
        await this.approvals.createToolApproval({
          taskId: input.taskId, runId, toolCallId: toolCall.id,
        });
        await this.state.transition({
          taskId: input.taskId, runId,
          from: "EXECUTING", to: "WAITING_FOR_TOOL_APPROVAL",
          reason: `${definition.riskLevel}-risk action requires human approval`,
        });
        return "AWAITING_TOOL_APPROVAL";
      }

      // ALLOW → execute through the harness.
      // Mid-loop checkpoint before destructive tool execution
      if (definition.riskLevel === "DESTRUCTIVE") {
        await this.checkpoints
          .tryCreatePreStep({
            taskId: input.taskId,
            runId,
            projectId: input.projectId,
            toolName: effective.toolName!,
            stepId: step.id,
          })
          .catch((err) => {
            this.logger.warn({ err, toolName: effective.toolName, stepId: step.id }, "Failed to create pre-step checkpoint for destructive tool");
          });
      }
      await this.fireHooks("beforeToolCall", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { toolName: effective.toolName, toolCallId: toolCall.id, stepId: step.id } });
      const result = await this.runAllowedTool(input, runId, toolCall.id, effective, budget, execEnvironment);
      await this.fireHooks(result.status === "SUCCEEDED" ? "afterToolCall" : "onToolError", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { toolName: effective.toolName, toolCallId: toolCall.id, status: result.status, failureCode: result.failureCode } });

      // Record tool execution in trace
      if (traceId) {
        this.traceBuilder!.addToolExecution(traceId, {
          toolName: effective.toolName!,
          input: effective.toolInput as Record<string, unknown>,
          output: result.output ?? null,
          status: result.status === "SUCCEEDED" ? "success" : "error",
          duration: result.durationMs ?? 0,
          reasoning: `Executing step ${step.id}: ${step.title}`,
        });
      }

      // ── OBSERVING: analyze tool output for errors and self-fix ──
      await this.state.transition({
        taskId: input.taskId, runId,
        from: "EXECUTING", to: "OBSERVING",
        reason: `Analyzing output of ${effective.toolName}`,
      });

      const observation = this.analyzeToolOutput(result, effective.toolName!);
      await this.events.publishAndEmit({
        taskId: input.taskId, runId,
        eventType: "TOOL_OBSERVED",
        actorType: "SYSTEM",
        payload: { toolCallId: toolCall.id, toolName: effective.toolName, observation },
      });

      // Record observation in trace
      if (traceId) {
        this.traceBuilder!.addObservation(traceId, {
          type: observation.hasError ? "error_detected" : "tool_result",
          content: observation.hasError
            ? `Error detected in ${effective.toolName}: ${observation.errorMessage ?? "unknown"}`
            : `${effective.toolName} completed successfully`,
          source: effective.toolName!,
          impact: observation.hasError ? "self_fix" : "none",
        });
      }

      if (observation.hasError) {
        // Self-fix: attempt to understand and recover from the error
        const selfFixResult = await this.attemptSelfFix(
          input, runId, ctx, budget, effective, observation,
        );
        if (selfFixResult === "REPLANNED") {
          return this.executionLoop(input, runId, ctx, budget, deadline, undefined, traceId);
        }
        // If self-fix didn't replan, fall through to standard failure handling
        if (result.status !== "SUCCEEDED") {
          const classification = result.classification ?? "non_retryable";
          if (classification === "retryable") {
            const retry = await this.harness.execute({
              toolCallId: toolCall.id, taskId: input.taskId, runId,
              toolName: effective.toolName!, input: effective.toolInput ?? {},
              environment: execEnvironment,
            });
            if (retry.status === "SUCCEEDED") {
              await this.state.transition({
                taskId: input.taskId, runId, from: "OBSERVING", to: "EXECUTING",
                reason: "Retry succeeded",
              });
              continue;
            }
          }
          const replanned = await this.replanAfterFailure(
            input, runId, ctx, budget,
            `Tool ${step.toolName} failed (${result.failureCode}): ${result.failureMessage}`,
          );
          if (replanned !== "PROCEED") return this.outcomeOf(replanned);
          return this.executionLoop(input, runId, ctx, budget, deadline, undefined, traceId);
        }
      }

      // Success path: return to EXECUTING for next step
      await this.state.transition({
        taskId: input.taskId, runId, from: "OBSERVING", to: "EXECUTING",
        reason: `${effective.toolName} succeeded`,
      });
    }

    // Verify → complete.
    await this.state.transition({
      taskId: input.taskId,
      runId,
      from: "EXECUTING",
      to: "VERIFYING",
    });
    // Auto-infer verification commands when plan has none (e.g. FIX mode or empty plan)
    let verifyCommands: Array<{ command: string }> = plan.verificationPlan as Array<{ command: string }>;
    if (!verifyCommands || verifyCommands.length === 0) {
      const { VerificationEngine } = await import("./verification-engine.js");
      verifyCommands = VerificationEngine.inferVerificationCommands({
        scripts: (ctx.projectAnalysis as { scripts?: Array<{ name: string; command: string; purpose: string }> })?.scripts,
        conventions: (ctx.projectAnalysis as { conventions?: { tsConfig?: boolean } })?.conventions,
        testSetup: (ctx.projectAnalysis as { testSetup?: { framework?: string | null; hasTests?: boolean } })?.testSetup,
      });
      if (verifyCommands.length > 0) {
        this.logger.info({ taskId: input.taskId, verifyCommands }, "auto-inferred verification commands");
      }
    }
    await this.fireHooks("beforeVerification", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { commandCount: verifyCommands.length } });
    const verification = await this.verification.verify({
      taskId: input.taskId, runId, commands: verifyCommands, projectId: input.projectId,
      root: ctx.project.rootReference,
      environment: this.executionEnvironmentFor("LOCAL_BRIDGE", ctx.project.connectionType),
    });
    await this.fireHooks("afterVerification", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { results: verification } });
    // Auto-replan on verification failure (verification is not just advisory)
    const failedVerifications = verification.filter((v) => v.status === "FAILED" || v.status === "ERROR");
    if (failedVerifications.length > 0) {
      const replanned = await this.replanAfterFailure(
        input, runId, ctx, budget,
        `Verification failed: ${failedVerifications.map((v) => `${v.command} → ${v.output?.slice(0, 200) ?? v.status}`).join("; ")}`,
      );
      if (replanned !== "PROCEED") return this.outcomeOf(replanned);
      // If replanned is PROCEED (replan budget available), re-enter loop with new plan
      return this.executionLoop(input, runId, ctx, budget, deadline, undefined, traceId);
    }

    // Record verification results in trace
    if (traceId) {
      for (const v of verification) {
        this.traceBuilder!.addVerification(traceId, {
          command: v.command,
          status: v.status === "PASSED" ? "passed" : "failed",
          output: v.output ?? "",
        });
      }
    }

    await this.state.transition({
      taskId: input.taskId, runId, from: "VERIFYING", to: "REVIEWING",
      reason: "Optional read-only reviewer stage",
    });
    const review = await this.runReview(input, runId, verification, plan.affectedFiles, traceId);

    // Optional policy gate: blocking findings fail the run instead of completing (F-16 opt-in).
    if (review && review.blocking.length > 0 && ctx.snapshot.blockOnReviewFindings) {
      await this.events.publishAndEmit({
        taskId: input.taskId,
        runId,
        eventType: "RUN_BLOCKED_BY_REVIEW",
        actorType: "SYSTEM",
        payload: { blocking: review.blocking },
      });
      throw Object.assign(
        new Error(
          `Reviewer found blocking issues: ${review.blocking.join("; ").slice(0, 400)}`,
        ),
        { name: "REVIEW_BLOCKED" },
      );
    }

    // ── Mandatory security scan before marking COMPLETED ──
    // Runs even when review has no blocking findings; non-blocking findings are
    // emitted as a SECURITY_SCAN event but do not fail the run.
    let securityFindings: Array<{ severity: string; rule: string; file?: string; message: string }> = [];
    try {
      const scanResult = await this.runSecurityScan(input.taskId, plan.affectedFiles);
      securityFindings = scanResult.findings;
      if (securityFindings.length > 0) {
        await this.events.publishAndEmit({
          taskId: input.taskId, runId,
          eventType: "SECURITY_SCAN",
          actorType: "SYSTEM",
          payload: { findings: securityFindings, scannedFiles: plan.affectedFiles },
        });
        const critical = securityFindings.filter((f) => f.severity === "critical" || f.severity === "high");
        if (critical.length > 0 && ctx.snapshot.blockOnReviewFindings) {
          await this.events.publishAndEmit({
            taskId: input.taskId, runId,
            eventType: "RUN_BLOCKED_BY_REVIEW",
            actorType: "SYSTEM",
            payload: { blocking: critical.map((f) => `${f.rule}: ${f.message}`) },
          });
          throw Object.assign(
            new Error(`Security scan found ${critical.length} critical/high issue(s): ${critical.map((f) => f.rule).join(", ").slice(0, 400)}`),
            { name: "REVIEW_BLOCKED" },
          );
        }
        if (traceId) {
          this.traceBuilder!.addObservation(traceId, {
            type: critical.length > 0 ? "error_detected" : "tool_result",
            content: `Security scan: ${securityFindings.length} finding(s), ${critical.length} critical/high`,
            source: "security-scan",
            impact: critical.length > 0 ? "escalate" : "none",
          });
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "REVIEW_BLOCKED") throw err;
      this.logger.warn({ err: redactValue(err), taskId: input.taskId }, "security scan failed — continuing to COMPLETED");
    }

    await this.fireHooks("beforeComplete", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { planId: planRow.id, stepCount: plan.steps.length, securityFindings: securityFindings.length } });
    await this.state.transition({
      taskId: input.taskId, runId, from: "REVIEWING", to: "COMPLETED",
      reason: "Steps processed; verification recorded; review + security scan finished",
    });
    await this.events.publishAndEmit({
      taskId: input.taskId, runId,
      eventType: TASK_EVENT_TYPES.RUN_COMPLETED,
      actorType: "SYSTEM",
      payload: {
        summary: `Completed ${plan.steps.length} planned step(s).`,
        verification: verification.map((v) => ({ command: v.command, status: v.status })),
        securityFindings: securityFindings.length > 0 ? securityFindings : undefined,
      },
    });
    await this.fireHooks("afterComplete", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { planId: planRow.id, stepCount: plan.steps.length, verificationPassed: verification.filter((v) => v.status === "PASSED").length } });

    // Complete observability trace
    if (traceId) {
      this.traceBuilder!.completeTrace(traceId, {
        status: "completed",
        filesChanged: plan.affectedFiles,
        testsRun: verification.length,
        testsPassed: verification.filter((v) => v.status === "PASSED").length,
        errorsEncountered: 0,
        selfFixesAttempted: 0,
      });
      // Persist trace to DB (survives worker restart)
      if (this.tracePersistence && this.traceBuilder) {
        const trace = this.traceBuilder.getTrace(traceId);
        if (trace) {
          void this.tracePersistence.saveTrace(trace).catch((err) => {
            this.logger.warn({ err }, "Failed to persist trace");
          });
        }
      }
    }

    // Archive the session on completion
    await this.archiveRunSession().catch((err) => {
      this.logger.warn({ err }, "Failed to archive session on completion");
    });

    return "COMPLETED";
  }

  // ── Resume helpers ─────────────────────────────────────────

  /** Index of the first step that has not completed in this run (based on persisted events). */
  private async resumeCursor(taskId: string, runId: string, steps: PlanStep[]): Promise<number> {
    const [lastCompleted, lastReplan] = await Promise.all([
      this.latestRunEvent(runId, TASK_EVENT_TYPES.TOOL_COMPLETED),
      this.latestRunEvent(runId, TASK_EVENT_TYPES.REPLAN_STARTED),
    ]);
    if (!lastCompleted) return 0;
    if (lastReplan && lastReplan.sequenceNumber > lastCompleted.sequenceNumber) return 0;
    const stepId = (lastCompleted.payload as { stepId?: string } | null)?.["stepId"];
    if (!stepId) return 0;
    const idx = steps.findIndex((s) => s.id === stepId);
    return idx >= 0 ? idx + 1 : 0;
  }

  /** Tool name of a denial that has no subsequent completion/replan yet. */
  private async latestUnhandledDenial(taskId: string, runId: string): Promise<string | null> {
    const [denial, completion, replan] = await Promise.all([
      this.latestRunEvent(runId, TASK_EVENT_TYPES.TOOL_DENIED),
      this.latestRunEvent(runId, TASK_EVENT_TYPES.TOOL_COMPLETED),
      this.latestRunEvent(runId, TASK_EVENT_TYPES.REPLAN_STARTED),
    ]);
    if (!denial) return null;
    const newestOther =
      completion?.sequenceNumber ?? replan?.sequenceNumber ?? denial.sequenceNumber;
    if (denial.sequenceNumber < newestOther) return null;
    const toolCallId = (denial.payload as { toolCallId?: string } | null)?.["toolCallId"];
    if (!toolCallId) return null;
    const call = await this.prisma.toolCall.findUnique({ where: { id: toolCallId } });
    return call?.status === "DENIED" && !call.resultSummary
      ? (call.toolName ?? null)
      : null;
  }

  private async latestRunEvent(runId: string, eventType: string) {
    return this.prisma.taskEvent.findFirst({
      where: { runId, eventType },
      orderBy: { sequenceNumber: "desc" },
    });
  }

  /**
   * Rebuilds the per-run budget from persisted state so caps (replans, tool
   * calls, model invocations) survive approval/tool-decision resumes instead of
   * resetting to zero on every continuation (which previously let a failing
   * plan loop forever through repeated approvals).
   */
  private async buildRunBudget(ctx: RunContext, runId: string): Promise<Budget> {
    const [replansUsed, toolCallsUsed, modelInvocationsUsed] = await Promise.all([
      this.prisma.taskEvent.count({ where: { runId, eventType: TASK_EVENT_TYPES.REPLAN_STARTED } }),
      this.prisma.toolCall.count({ where: { runId } }),
      this.prisma.taskEvent.count({ where: { runId, eventType: TASK_EVENT_TYPES.MODEL_INVOCATION_RECORDED } }),
    ]);
    return {
      ...DEFAULT_RUN_BOUNDS,
      maxDurationMs: Math.min(DEFAULT_RUN_BOUNDS.maxDurationMs, ctx.snapshot.maxTaskDurationSeconds * 1000),
      maxToolCalls: Math.min(DEFAULT_RUN_BOUNDS.maxToolCalls, ctx.snapshot.maxToolCallsPerRun),
      toolCallsUsed,
      modelInvocationsUsed,
      replansUsed,
    };
  }

  /**
   * CLOUD projects have no local bridge: filesystem/git/terminal tools must
   * route to the docker sandbox (CLOUD_SANDBOX) instead of the bridge. INTERNAL
   * tools and LOCAL_BRIDGE projects keep their definition environment.
   */
  private executionEnvironmentFor(
    definitionEnvironment: ExecutionEnvironment,
    connectionType: "CLOUD" | "LOCAL_BRIDGE",
  ): ExecutionEnvironment {
    if (definitionEnvironment === "LOCAL_BRIDGE" && connectionType === "CLOUD") return "CLOUD_SANDBOX";
    return definitionEnvironment;
  }

  /**
   * Root-scoped tools require a root path that models cannot know (and must not
   * choose — an arbitrary root would mount unrelated host directories in the
   * sandbox), so the project's declared rootReference is authoritative.
   */
  private withProjectRoot<T extends { toolName?: string | null; toolInput?: unknown }>(step: T, ctx: RunContext): T {
    if (!/^(filesystem|git|terminal)\./.test(step.toolName ?? "")) return step;
    if (!ctx.project.rootReference) return step;
    const input = { ...((step.toolInput ?? {}) as Record<string, unknown>) };
    input["root"] = ctx.project.rootReference;
    return { ...step, toolInput: input };
  }

  /**
   * Gives the implementation model a chance to PROPOSE one concrete tool
   * action for a reasoning-only plan step. Proposals re-enter the standard
   * permission gate; models without tool support (or no useful proposal)
   * simply complete the step as reasoning.
   */
  /** Throttled MODEL_TEXT_DELTA publisher for streaming model stages. */
  private deltaPublisher(taskId: string, runId: string): (text: string) => void {
    let buffer = "";
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (buffer.length > 0) {
        const chunk = buffer;
        buffer = "";
        last = 0;
        if (timer) { clearTimeout(timer); timer = null; }
        void this.events
          .publishAndEmit({
            taskId, runId,
            eventType: TASK_EVENT_TYPES.MODEL_TEXT_DELTA,
            actorType: "AGENT",
            payload: { text: chunk.slice(0, 2000), final: true },
          })
          .catch((err) => {
            this.logger.warn({ err }, "Failed to publish final text delta event");
          });
      }
    };
    const publisher = (text: string) => {
      buffer += text;
      const now = Date.now();
      if (now - last < 400) return;
      last = now;
      const chunk = buffer;
      buffer = "";
      if (timer) { clearTimeout(timer); timer = null; }
      void this.events
        .publishAndEmit({
          taskId, runId,
          eventType: TASK_EVENT_TYPES.MODEL_TEXT_DELTA,
          actorType: "AGENT",
          payload: { text: chunk.slice(0, 2000), final: false },
        })
        .catch((err) => {
          this.logger.warn({ err }, "Failed to publish streaming text delta event");
        });
    };
    (publisher as unknown as { __flush: () => void }).__flush = flush;
    return publisher;
  }
  private async proposeNextAction(
    input: RunInput,
    runId: string,
    ctx: RunContext,
    budget: Budget,
    step: PlanStep,
    traceId?: string,
  ): Promise<{ name: string; input: Record<string, unknown> } | null> {
    if (budget.modelInvocationsUsed >= budget.maxModelInvocations) return null;
    let routes: import("./model-router.js").RouteDecision[];
    try {
      routes = await this.router.resolveWithFallbacks({
        userId: input.userId, workspaceId: input.workspaceId,
        stage: "IMPLEMENTATION", override: input.modelOverride ?? undefined,
      });
    } catch (err) {
      this.logger.warn({ err }, "failed to resolve implementation route");
      return null; // no implementation route — reasoning-only step stands
    }
    budget.modelInvocationsUsed += 1;
    let lastError: unknown = null;
    for (const route of routes) {
      const adapter = this.adapters.get(route.providerConnection.providerType);
      if (!adapter) continue;
      const request: ModelRequest = {
        stage: "IMPLEMENTATION",
        modelIdentifier: route.modelIdentifier,
        systemInstructions: RUNTIME_SYSTEM_INSTRUCTIONS,
        userObjective: [
          `Current plan step: ${step.title}`,
          step.detail ? `Step detail: ${step.detail}` : "",
          "",
          "If executing this step requires one of the available tools, call exactly one tool now with correct arguments.",
          "If the step needs no tool (pure documentation/analysis), reply with plain text and no tool call.",
        ].filter(Boolean).join("\n"),
        contextItems: `Goal:\n${input.goal}${input.constraints ? `\nConstraints:\n${input.constraints}` : ""}`,
        toolDefinitions: this.tools.toModelDefinitions(),
        responseSchemaName: "FREEFORM",
      };
      try {
        const response = await adapter.generate(request, route.providerConnection);

        await this.events.publishAndEmit({
          taskId: input.taskId, runId,
          eventType: TASK_EVENT_TYPES.MODEL_INVOCATION_RECORDED,
          actorType: "AGENT",
          payload: {
            stage: "IMPLEMENTATION",
            providerType: route.providerConnection.providerType,
            modelIdentifier: route.modelIdentifier,
            finishReason: response.finishReason,
            usage: response.usage,
          },
        });

        // Track token usage
        if (response.usage.inputTokens && response.usage.outputTokens) {
          await this.trackTokenUsage({
            userId: input.userId,
            workspaceId: input.workspaceId,
            taskId: input.taskId,
            providerType: route.providerConnection.providerType,
            modelIdentifier: route.modelIdentifier,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            stage: request.stage,
            traceId,
          });
        }

        const call = response.toolCalls?.[0];
        if (!call || !this.tools.get(call.name)) return null;
        await this.events.publishAndEmit({
          taskId: input.taskId, runId,
          eventType: "ACTION_PROPOSED",
          actorType: "AGENT",
          payload: { stepId: step.id, toolName: call.name },
        });
        return { name: call.name, input: call.input };
      } catch (err) {
        lastError = err;
        const retryable = err instanceof AdapterError ? err.retryable : false;
        if (!retryable) {
          this.logger.warn({ err: redactValue(err) }, "action proposal failed (non-retryable)");
          return null;
        }
        this.logger.warn({ err: redactValue(err), routeId: route.routeId }, "action proposal retryable failure, trying fallback if available");
        continue;
      }
    }
    if (lastError) this.logger.warn({ err: redactValue(lastError) }, "action proposal failed after fallbacks");
    return null;
  }

  /** Optional reviewer stage (read-only). Never blocks completion on its own failure. */
  private async runReview(
    input: RunInput,
    runId: string,
    verification: Array<{ command: string; status: string }>,
    affectedFiles: string[],
    traceId?: string,
  ): Promise<{ blocking: string[]; non_blocking: string[]; confidence: string } | null> {
    const reviewSchema = z.object({
      blocking: z.array(z.string()).default([]),
      non_blocking: z.array(z.string()).default([]),
      confidence: z.enum(["low", "medium", "high"]).default("low"),
    });
    try {
      let routes: import("./model-router.js").RouteDecision[];
      try {
        routes = await this.router.resolveWithFallbacks({
          userId: input.userId, workspaceId: input.workspaceId,
          stage: "REVIEW", override: null,
        });
      } catch {
        routes = await this.router.resolveWithFallbacks({ userId: input.userId, workspaceId: input.workspaceId, stage: "IMPLEMENTATION", override: null });
      }
      const budgetKey = `${input.taskId}:${runId}`;
      const remaining = this.reviewBudgets.get(budgetKey) ?? 2;
      if (remaining <= 0) throw new Error("review budget exhausted");
      this.reviewBudgets.set(budgetKey, remaining - 1);
      let lastReviewError: unknown = null;
      for (const route of routes) {
        const adapter = this.adapters.get(route.providerConnection.providerType);
        if (!adapter) continue;
        const request: ModelRequest = {
          stage: "REVIEW",
          modelIdentifier: route.modelIdentifier,
          systemInstructions:
            "You are a READ-ONLY code reviewer. You cannot modify anything. Respond with ONLY JSON: " +
            '{"blocking": string[], "non_blocking": string[], "confidence": "low"|"medium"|"high"}.',
          userObjective: "Review the completed implementation for correctness and safety risks.",
          contextItems: `Affected files:\n${affectedFiles.join("\n") || "(none recorded)"}\n\nVerification:\n${verification
            .map((v) => `${v.status} ${v.command}`)
            .join("\n")}\n\nTask goal:\n${input.goal}`,
          responseSchemaName: "PLAN",
        };
        try {
          const response = await adapter.generate(request, route.providerConnection);

          await this.events.publishAndEmit({
            taskId: input.taskId, runId,
            eventType: TASK_EVENT_TYPES.MODEL_INVOCATION_RECORDED,
            actorType: "AGENT",
            payload: {
              stage: "REVIEW",
              providerType: route.providerConnection.providerType,
              modelIdentifier: route.modelIdentifier,
              finishReason: response.finishReason,
              usage: response.usage,
            },
          });

          // Track token usage for review
          if (response.usage.inputTokens && response.usage.outputTokens) {
            await this.trackTokenUsage({
              userId: input.userId,
              workspaceId: input.workspaceId,
              taskId: input.taskId,
              providerType: route.providerConnection.providerType,
              modelIdentifier: route.modelIdentifier,
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              stage: "REVIEW",
              traceId,
            });
          }

          const parsed = reviewSchema.safeParse(extractJson(response.text));
          if (!parsed.success) throw new Error("review schema mismatch");
          await this.events.publishAndEmit({
            taskId: input.taskId, runId,
            eventType: TASK_EVENT_TYPES.VERIFICATION_COMPLETED,
            actorType: "AGENT",
            payload: {
              review: parsed.data,
              note: "Reviewer output is advisory only (PRD F-16).",
            },
          });
          return parsed.data;
        } catch (err) {
          lastReviewError = err;
          const retryable = err instanceof AdapterError ? err.retryable : false;
          if (!retryable) throw err;
          // retryable -> try next fallback route
          continue;
        }
      }
      throw lastReviewError ?? new Error("review unavailable: no viable route");
    } catch (err) {
      await this.events.publishAndEmit({
        taskId: input.taskId, runId,
        eventType: "REVIEW_SKIPPED",
        actorType: "SYSTEM",
        payload: { reason: err instanceof Error ? err.message.slice(0, 200) : "review unavailable" },
      });
      return null;
    }
  }

  private reviewBudgets = new Map<string, number>();

  /**
   * Lightweight static security scan of affected files.
   * Checks for common vulnerability patterns without requiring external tools.
   * Findings are informational unless blockOnReviewFindings is enabled.
   */
  private async runSecurityScan(
    taskId: string,
    affectedFiles: string[],
  ): Promise<{ findings: Array<{ severity: string; rule: string; file?: string; message: string }> }> {
    const findings: Array<{ severity: string; rule: string; file?: string; message: string }> = [];
    if (affectedFiles.length === 0) return { findings };

    // Scan file versions for known patterns (best-effort — file may be in bridge env)
    for (const filePath of affectedFiles.slice(0, 50)) {
      try {
        const versions = await this.prisma.fileVersion.findMany({
          where: { path: filePath },
          orderBy: { version: "desc" },
          take: 1,
          select: { metadata: true },
        });
        // FileVersion stores content hash only; scan metadata + try to read actual content
        // from the project's file storage if available
        const meta = versions[0]?.metadata as Record<string, unknown> | undefined;
        const content = typeof meta?.["content"] === "string" ? (meta["content"] as string) : undefined;
        if (!content) continue;

        // Rule: hardcoded secrets
        if (/(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{8,}["']/i.test(content)) {
          findings.push({ severity: "high", rule: "HARDCODED_SECRET", file: filePath, message: "Possible hardcoded secret detected" });
        }
        // Rule: SQL injection pattern
        if (/\$\{[^}]*\}.*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(content) || /query\s*\(\s*`[^`]*\$\{/i.test(content)) {
          findings.push({ severity: "high", rule: "SQL_INJECTION", file: filePath, message: "Possible SQL injection via template literal" });
        }
        // Rule: XSS — dangerouslySetInnerHTML without sanitization
        if (/dangerouslySetInnerHTML/i.test(content) && !/sanitize|escape|DOMPurify/i.test(content)) {
          findings.push({ severity: "medium", rule: "XSS_DANGEROUS_HTML", file: filePath, message: "dangerouslySetInnerHTML without sanitization" });
        }
        // Rule: eval / Function constructor
        if (/\b(?:eval|Function)\s*\(/i.test(content)) {
          findings.push({ severity: "high", rule: "CODE_INJECTION", file: filePath, message: "Use of eval() or Function() constructor" });
        }
        // Rule: missing auth check on API route
        if (/app\.(get|post|put|delete|patch)\s*\(/i.test(content) && !/authenticate|requireWorkspaceRole|preHandler/i.test(content)) {
          findings.push({ severity: "medium", rule: "MISSING_AUTH", file: filePath, message: "API route without authentication middleware" });
        }
      } catch {
        // File not in FileVersion table (local bridge) — skip
      }
    }
    return { findings };
  }

  /**
   * Syncs tool definitions from registered tool extensions into the ToolRegistry
   * so they are available during plan execution.
   */
  private syncExtensionTools(): void {
    if (!this.extensionRegistry) return;
    const toolExtensions = this.extensionRegistry.listExtensions("tool") as ToolExtension[];
    for (const ext of toolExtensions) {
      if (this.extensionRegistry.getState(ext.manifest.name)?.lifecycle !== "active") continue;
      try {
        const toolDefs = ext.getToolDefinitions();
        for (const def of toolDefs) {
          // Preserve extension-supplied JSON Schema as Zod when possible
          let inputSchema: z.ZodTypeAny = z.record(z.unknown());
          const resultSchema: z.ZodTypeAny = z.record(z.unknown()).optional();
          const rawSchema = (def as unknown as { inputSchema?: unknown }).inputSchema;
          if (rawSchema && typeof rawSchema === "object" && "type" in (rawSchema as Record<string, unknown>)) {
            try {
              // If extension supplies JSON Schema, wrap as validated passthrough
              const jsonSchema = rawSchema as Record<string, unknown>;
              inputSchema = z.record(z.unknown()).superRefine((val, ctx) => {
                // Lightweight required-field check from JSON Schema
                const required = jsonSchema["required"] as string[] | undefined;
                if (Array.isArray(required)) {
                  for (const key of required) {
                    if (!(key in (val as Record<string, unknown>))) {
                      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required field: ${key}` });
                    }
                  }
                }
              });
            } catch {
              // Fall back to permissive schema
            }
          }
          this.tools.registerDynamic({
            name: def.name,
            description: def.description,
            riskLevel: mapExtensionRiskLevel(def.riskLevel),
            inputSchema,
            resultSchema,
            timeoutMs: 30_000,
            outputLimitBytes: 100 * 1024,
            environment: "INTERNAL",
          });
        }
      } catch (err) {
        this.logger.warn(
          { err, extension: ext.manifest.name },
          "Failed to load tools from extension",
        );
      }
    }
  }

  private async runAllowedTool(
    input: RunInput,
    runId: string,
    toolCallId: string,
    step: PlanStep,
    _budget: Budget,
    environment: ExecutionEnvironment,
  ) {
    await this.prisma.toolCall.update({
      where: { id: toolCallId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await this.events.publishAndEmit({
      taskId: input.taskId, runId,
      eventType: TASK_EVENT_TYPES.TOOL_STARTED,
      actorType: "TOOL",
      payload: { toolCallId, toolName: step.toolName },
    });
    const result = await this.harness.execute({
      toolCallId, taskId: input.taskId, runId,
      toolName: step.toolName!, input: step.toolInput ?? {},
      environment,
    });
    await this.prisma.toolCall.update({
      where: { id: toolCallId },
      data: {
        status: result.status,
        resultSummary: {
          ...(result.output ?? {}),
          failureCode: result.failureCode,
          failureMessage: result.failureMessage,
          durationMs: result.durationMs,
        },
        completedAt: new Date(),
      },
    });
    await this.events.publishAndEmit({
      taskId: input.taskId, runId,
      eventType: result.status === "SUCCEEDED" ? TASK_EVENT_TYPES.TOOL_COMPLETED : TASK_EVENT_TYPES.TOOL_FAILED,
      actorType: "TOOL",
      payload: {
        toolCallId, toolName: step.toolName!, stepId: step.id,
        status: result.status, failureCode: result.failureCode, durationMs: result.durationMs,
      },
    });

    // Persist tool call to session
    await this.recordToolCallToSession(step.toolName!, step.toolInput ?? {}, result.output, result.status === "SUCCEEDED", result.durationMs ?? 0).catch((err) => {
      this.logger.warn({ err }, "Failed to record tool call to session");
    });

    // ── CodeSearch + FileWatcher hook: keep search index in sync with filesystem tool executions ──
    // Pragmatic hook: filesystem writes/creates/deletes/renames update CodeSearch; FileWatcher emits for observability.
    if (result.status === "SUCCEEDED" && (this.codeSearch || this.fileWatcher)) {
      try {
        const toolName = step.toolName as string;
        const toolInput = (step.toolInput ?? {}) as Record<string, unknown>;
        if (toolName === "filesystem.write" || toolName === "filesystem.create") {
          const p = typeof toolInput["path"] === "string" ? (toolInput["path"] as string) : null;
          const content = typeof toolInput["content"] === "string" ? (toolInput["content"] as string) : "";
          if (p) {
            this.codeSearch?.indexFile(p, content);
            this.fileWatcher?.emit({ type: toolName === "filesystem.create" ? "create" : "modify", path: p, timestamp: new Date() });
          }
        } else if (toolName === "filesystem.delete") {
          const p = typeof toolInput["path"] === "string" ? (toolInput["path"] as string) : null;
          if (p) {
            this.codeSearch?.removeFile(p);
            this.fileWatcher?.emit({ type: "delete", path: p, timestamp: new Date() });
          }
        } else if (toolName === "filesystem.rename") {
          const from = typeof toolInput["from"] === "string" ? (toolInput["from"] as string) : null;
          const to = typeof toolInput["to"] === "string" ? (toolInput["to"] as string) : null;
          if (from) {
            this.codeSearch?.removeFile(from);
            this.fileWatcher?.emit({ type: "delete", path: from, timestamp: new Date() });
          }
          if (to) {
            this.fileWatcher?.emit({ type: "create", path: to, timestamp: new Date() });
          }
        }
      } catch (err) {
        this.logger.warn({ err, toolName: step.toolName }, "CodeSearch/FileWatcher sync failed");
      }
    }

    return result;
  }

  private async replanAfterFailure(
    input: RunInput,
    runId: string,
    ctx: RunContext,
    budget: Budget,
    failureSummary: string,
  ): Promise<"PROCEED" | RunOutcome> {
    budget.replansUsed += 1;
    if (budget.replansUsed > DEFAULT_RUN_BOUNDS.maxReplans) {
      throw Object.assign(new Error(failureSummary), {
        name: FAILURE_CODES.MAX_REPLANS_EXCEEDED,
      });
    }
    await this.events.publishAndEmit({
      taskId: input.taskId, runId,
      eventType: TASK_EVENT_TYPES.REPLAN_STARTED,
      actorType: "SYSTEM",
      payload: { attempt: budget.replansUsed, failureSummary },
    });
    await this.fireHooks("onReplan", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { attempt: budget.replansUsed, failureSummary } });

    const currentState = (await this.prisma.task.findUniqueOrThrow({ where: { id: input.taskId } })).state;
    let state = await this.state.transition({
      taskId: input.taskId, runId, from: currentState as TaskState, to: "REPLANNING",
      reason: failureSummary.slice(0, 300),
    });

    this.assertBudget(budget, Date.now() + budget.maxDurationMs);
    const routes = await this.router.resolveWithFallbacks({
      userId: input.userId, workspaceId: input.workspaceId, stage: "IMPLEMENTATION",
      override: null,
    }).catch(() => null);
    const route = routes?.[0] ?? null;
    const adapter = route ? this.adapters.get(route.providerConnection.providerType) : undefined;
    if (!adapter || !route || !routes) throw errors.providerUnavailable();

    budget.modelInvocationsUsed += 1;
    const fallbackRoutes = routes.slice(1);
    const draft = await this.planner.createPlan({
      taskId: input.taskId,
      runId,
      goal: input.goal,
      constraints: [input.constraints, `PRIOR FAILURE TO ADDRESS: ${failureSummary}`].filter(Boolean).join("\n"),
      workspaceInstructions: ctx.instructions,
      adapter, route,
      fallbackRoutes,
      getAdapter: (t) => this.adapters.get(t),
      revisionInstruction: "Recover from the prior failure described in constraints.",
      previousPlan: await this.latestPlanAny(input.taskId),
      publish: (p) => this.events.publishAndEmit(p),
    });

    const saved = await persistNewPlanVersion(this.prisma, {
      taskId: input.taskId, runId, plan: draft, supersedePrevious: true,
    });
    await this.events.publishAndEmit({
      taskId: input.taskId, runId,
      eventType: TASK_EVENT_TYPES.PLAN_CREATED,
      actorType: "AGENT",
      payload: { planId: saved.id, version: saved.version, stepCount: draft.steps.length, replan: true },
    });
    await this.fireHooks("afterPlan", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { planId: saved.id, version: saved.version, stepCount: draft.steps.length, replan: true } });

    if (ctx.snapshot.requirePlanApproval) {
      state = await this.state.transition({
        taskId: input.taskId, runId, from: state, to: "WAITING_FOR_APPROVAL",
        reason: "Revised plan requires approval",
      });
      return "AWAITING_PLAN_APPROVAL";
    }
    await this.prisma.taskPlan.update({
      where: { id: saved.id }, data: { status: "APPROVED", approvedAt: new Date() },
    });
    await this.state.transition({
      taskId: input.taskId, runId, from: state, to: "EXECUTING",
      reason: "Auto-approved revised plan (allowDirectExecution)",
    });
    return "PROCEED";
  }

  // ── Control flags / helpers ────────────────────────────────

  private async checkControlFlags(taskId: string, runId: string): Promise<RunOutcome | null> {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId }, select: { state: true, cancelRequested: true, pauseRequested: true },
    });
    if (task.cancelRequested) {
      const from = task.state as TaskState;
      if (from !== "CANCELLED" && !isTerminalState(from)) {
        await this.state.failCancelled(taskId, runId, from);
      }
      return "CANCELLED";
    }
    if (task.pauseRequested && task.state === "EXECUTING") {
      await this.state.transition({
        taskId, runId, from: "EXECUTING", to: "INTERRUPTED",
        reason: "Pause requested by user",
      });
      return "INTERRUPTED";
    }
    return null;
  }

  private async cancelFromState(taskId: string, userId: string, from: TaskState, reason: string) {
    resolveCancel(from);
    const run = await this.prisma.taskRun.findFirst({
      where: { taskId, state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
    });
    await this.state.transition({
      taskId, runId: run?.id ?? null, from, to: "CANCELLED",
      actorType: "USER", reason,
    });
    await this.recordAudit(userId, taskId, "TASK_CANCELLED", taskId, { reason });
    await this.events.publishAndEmit({
      taskId, runId: run?.id ?? null,
      eventType: TASK_EVENT_TYPES.RUN_CANCELLED,
      actorType: "USER", payload: { reason },
    });
  }

  private async handleStageFailure(input: RunInput, runId: string, state: TaskState, err: unknown): Promise<RunOutcome> {
    // AppError.name is always "AppError" — match on its .code so structured
    // failures (PROVIDER_UNAVAILABLE, POLICY_DENIED, ...) keep their identity
    // instead of collapsing into INTERNAL_ERROR.
    const failureCode =
      err instanceof AppError && FAILURE_CODE_NAMES.has(err.code)
        ? err.code
        : err instanceof Error && err.name && FAILURE_CODE_NAMES.has(err.name)
          ? err.name
          : err instanceof AdapterError
            ? FAILURE_CODES.PROVIDER_ERROR
            : FAILURE_CODES.INTERNAL_ERROR;
    this.logger.error({ err, taskId: input.taskId, runId }, "run failed");
    await this.fireHooks("onError", { taskId: input.taskId, runId, projectId: input.projectId, workspaceId: input.workspaceId, payload: { failureCode, message: String(err instanceof Error ? err.message : err) } }).catch(() => undefined);
    try {
      // Re-read current state from DB to avoid stale transition
      const fresh = await this.prisma.task.findUnique({
        where: { id: input.taskId }, select: { state: true },
      });
      const currentState = (fresh?.state as TaskState) ?? state;
      if (!isTerminalState(currentState)) {
        await this.state.failRun({
          taskId: input.taskId, runId, from: currentState,
          failureCode,
          failureMessage: redactValue(String(err instanceof Error ? err.message : err)),
        });
      }
    } catch (transitionErr) {
      this.logger.error({ err: transitionErr }, "CRITICAL: failed to transition task to terminal FAILED state");
      await this.recordAudit("SYSTEM", input.taskId, "RUN_FAILED_TRANSITION_FAILED", runId, {
        failureCode,
        originalError: String(err),
        transitionError: String(transitionErr),
      }).catch((auditErr) => {
        this.logger.warn({ err: auditErr }, "Failed to record audit for transition failure");
      });
    }

    // Archive the session on failure
    await this.archiveRunSession().catch((err) => {
      this.logger.warn({ err }, "Failed to archive session on failure");
    });

    return "FAILED";
  }

  private async buildAndPersistContext(input: RunInput, runId: string): Promise<void> {
    const rawInstructions = (
      await this.prisma.workspaceInstructionVersion.findFirst({
        where: { workspaceId: input.workspaceId },
        orderBy: { version: "desc" },
      })
    )?.content ?? null;
    // Per-mode instruction inheritance: REVIEW/ASK modes are read-only — surface that in the assembled context
    const mode = input.agentMode ?? "BUILD";
    const instructions =
      mode === "REVIEW" || mode === "ASK"
        ? rawInstructions
          ? `${rawInstructions}\n\n[MODE CONSTRAINT: ${mode} mode is read-only — do not propose or execute mutations; provide analysis / answers only.]`
          : `[MODE CONSTRAINT: ${mode} mode is read-only — do not propose or execute mutations; provide analysis / answers only.]`
        : rawInstructions;

    // Gather repo analysis + repo map (Aider-style: file tree + symbols give the LLM structural awareness)
    let projectAnalysis: import("@ai-harness/context-engine").ProjectAnalysisContext | null = null;
    let repoMapStr: string | null = null;
    let surgicalContext: string | null = null;
    let dependencyConfig: string | null = null;
    try {
      const project = await this.prisma.project.findUnique({ where: { id: input.projectId } });
      if (project?.rootReference) {
        // Attempt to list actual project files for real repo analysis (bridge or file versions)
        const fileEntries: Array<{ path: string; type: "file" | "directory" }> = [];
        let pkgContent: string | null = null;
        let envContent: string | null = null;
        try {
          const fileVersions = await this.prisma.fileVersion.findMany({
            where: { projectId: input.projectId },
            select: { path: true, metadata: true },
            orderBy: { createdAt: "desc" },
            take: 2000,
          });
          // Also try to read package.json / .env.example from FileVersion metadata for analysis
          let pkgContentLocal: string | null = null;
          let envContentLocal: string | null = null;
          const seen = new Set<string>();
          for (const fv of fileVersions) {
            if (!seen.has(fv.path)) {
              seen.add(fv.path);
              fileEntries.push({ path: fv.path, type: "file" as const });
              const meta = fv.metadata as Record<string, unknown> | null;
              // Check if metadata stores content preview (some bridges may do this)
              if ((fv.path === "package.json" || fv.path.endsWith("/package.json")) && meta?.["content"]) {
                pkgContentLocal = String(meta["content"]);
              }
              if (fv.path === ".env.example" && meta?.["content"]) {
                envContentLocal = String(meta["content"]);
              }
            }
          }
          pkgContent = pkgContentLocal;
          envContent = envContentLocal;
        } catch { /* best-effort */ }

        if (pkgContent) dependencyConfig = pkgContent;

        const analysis: RepoAnalysis = analyzeRepository(fileEntries, pkgContent, envContent, null);
        projectAnalysis = {
          projectType: analysis.projectType,
          languages: analysis.languages.map((l) => ({ name: l.name, fileCount: l.fileCount })),
          frameworks: analysis.frameworks.map((f) => ({ name: f.name, type: f.type })),
          packageManager: { name: analysis.packageManager.name, workspaces: analysis.packageManager.workspaces },
          scripts: analysis.scripts.map((s) => ({ name: s.name, command: s.command, purpose: s.purpose })),
          conventions: { tsConfig: analysis.conventions.tsConfig, moduleSystem: analysis.conventions.moduleSystem },
          testSetup: { framework: analysis.testSetup.framework, hasTests: analysis.testSetup.hasTests },
          databaseInfo: analysis.databaseInfo,
          entryPoints: analysis.entryPoints,
          envRequirements: analysis.envRequirements.map((e) => ({ variable: e.variable, required: e.required })),
        };

        // Build lightweight repo map (ranked file listing grouped by directory)
        if (fileEntries.length > 0) {
          repoMapStr = this.buildRepoMap(fileEntries);
        }

        // Agentic search: generate surgical context block from edit intent (Lovable pattern)
        if (fileEntries.length > 0) {
          try {
            const { generateSearchPlan, scoreFiles, buildSurgicalBlock } = await import("@ai-harness/context-engine");
            const plan = generateSearchPlan(input.goal, fileEntries.map((f) => f.path), input.constraints);
            const candidates = scoreFiles(plan, fileEntries.map((f) => f.path), { maxResults: 1 });
            const target = candidates[0] ?? null;
            surgicalContext = buildSurgicalBlock(plan, target);
          } catch { /* best-effort */ }
        }
      }
    } catch (err) {
      this.logger.warn({ err, taskId: input.taskId }, "repo analysis failed");
      // Repo analysis is best-effort; proceed without it
    }

    // Resources exposed by workspace MCP servers (best-effort; empty registry → tier omitted)
    let mcpResources: string | null = null;
    if (this.mcpRegistry) {
      try {
        const servers = this.mcpRegistry.listServersByWorkspace(input.workspaceId);
        const lines: string[] = [];
        for (const s of servers) {
          for (const r of s.resources ?? []) {
            lines.push(`- [${s.config.name}] ${r.uri} — ${r.name}${r.description ? `: ${r.description}` : ""}`);
          }
        }
        mcpResources = lines.length > 0 ? lines.join("\n") : null;
      } catch { /* best-effort */ }
    }

    const assembled = assembleContext({
      systemInstructions: RUNTIME_SYSTEM_INSTRUCTIONS,
      workspaceInstructions: instructions,
      goal: input.goal,
      constraints: input.constraints,
      projectAnalysis,
      repoMap: repoMapStr,
      surgicalContext,
      dependencyConfig,
      mcpResources,
    });
    await this.prisma.contextPackage.create({
      data: {
        taskId: input.taskId,
        runId,
        stage: "PLANNING",
        manifest: assembled.manifest as unknown as Prisma.InputJsonValue,
        estimatedTokens: estimateTokens(assembled.manifest.usedBytes),
      },
    });
    await this.events.publishAndEmit({
      taskId: input.taskId, runId,
      eventType: TASK_EVENT_TYPES.CONTEXT_BUILT,
      actorType: "SYSTEM",
      payload: {
        itemCount: assembled.manifest.items.length,
        omittedCount: assembled.manifest.omitted.length,
        usedBytes: assembled.manifest.usedBytes,
        estimatedTokens: estimateTokens(assembled.manifest.usedBytes),
      },
    });
  }

  /** Lightweight repo map: directory-grouped listing (top 500 files, skip vendored). */
  /** PageRank-lite repo map: score files by how many other files reference them (Aider-inspired). */
  private buildRepoMap(files: Array<{ path: string; type: string }>): string {
    const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo", "vendor", "__pycache__"]);
    const filtered = files
      .map((f) => f.path)
      .filter((p) => !p.split("/").some((seg) => SKIP_DIRS.has(seg)))
      .slice(0, 500);
    if (filtered.length === 0) return "";

    // Build a lightweight reference graph: count how many file basenames appear in other paths
    // (approximates Aider's tree-sitter referencer→definer edge without parsing)
    const basenameCounts = new Map<string, number>();
    for (const p of filtered) {
      const base = p.split("/").pop()!.replace(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/, "");
      if (base.length >= 3) {
        basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
      }
    }
    // Score each file: base boost from name uniqueness + directory depth penalty + entry-point bonus
    const scored = filtered.map((p) => {
      let score = 1;
      const base = p.split("/").pop()!.replace(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/, "");
      // Frequently-referenced basenames rank higher (like Aider's sqrt(refs) weight)
      const refs = basenameCounts.get(base) ?? 0;
      if (refs > 1) score += Math.sqrt(refs) * 2;
      // Entry points and index files are important
      if (/^(index|main|app|server|entry|_app|layout)\.(ts|tsx|js|jsx)$/.test(p.split("/").pop()!)) score += 5;
      if (p.includes("route") || p.includes("controller") || p.includes("handler")) score += 2;
      // Deeper files slightly less ranked
      score -= p.split("/").length * 0.3;
      // Longer meaningful names rank higher (Aider pattern: snake|camel with len>=8 gets *10)
      if (base.length >= 8 && /[_-]|(?<=[a-z])[A-Z]/.test(base)) score += 1;
      return { path: p, score };
    });
    scored.sort((a, b) => b.score - a.score);

    // Top 100 ranked files first, then directory-grouped remainder
    const topRanked = scored.slice(0, 100);
    const remaining = scored.slice(100);

    const lines: string[] = ["## Repository Map (PageRank-lite ranked)"];
    if (topRanked.length > 0) {
      lines.push("\n### Most referenced files (highest PageRank)");
      for (const { path: p, score } of topRanked.slice(0, 40)) {
        lines.push(`  ${p} [${score.toFixed(1)}]`);
      }
      if (topRanked.length > 40) lines.push(`  ... and ${topRanked.length - 40} more ranked files`);
    }
    if (remaining.length > 0) {
      const groups = new Map<string, string[]>();
      for (const { path: p } of remaining) {
        const top = p.includes("/") ? p.split("/")[0]! : ".";
        const list = groups.get(top) ?? [];
        list.push(p);
        groups.set(top, list);
      }
      const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [dir, paths] of sortedGroups) {
        lines.push(`\n### ${dir}/ (${paths.length} files)`);
        for (const p of paths.slice(0, 60)) lines.push(`  ${p}`);
        if (paths.length > 60) lines.push(`  ... and ${paths.length - 60} more`);
      }
    }
    return lines.join("\n");
  }

  private async loadContext(input: RunInput): Promise<RunContext> {
    const task = await this.prisma.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw errors.notFound("Task");
    return this.loadContextFromTask(task);
  }

  private async loadContextFromTask(task: Task): Promise<RunContext> {
    const [workspace, project] = await Promise.all([
      this.prisma.workspace.findUnique({
        where: { id: task.workspaceId },
        include: { policy: { include: { toolRules: true } } },
      }),
      this.prisma.project.findUnique({ where: { id: task.projectId } }),
    ]);
    if (!workspace?.policy) throw errors.notFound("Workspace policy");
    if (!project) throw errors.notFound("Project");
    const instructionsRow = await this.prisma.workspaceInstructionVersion.findFirst({
      where: { workspaceId: task.workspaceId },
      orderBy: { version: "desc" },
    });
    const rawInstructions = instructionsRow?.content ?? null;
    // Per-mode inheritance: REVIEW/ASK plans must carry a read-only note so the LLM does not propose mutations.
    const mode = task.agentMode as string | undefined;
    const instructions =
      mode === "REVIEW" || mode === "ASK"
        ? rawInstructions
          ? `${rawInstructions}\n\n[MODE CONSTRAINT: ${mode} mode is read-only — do not propose or execute mutations; provide analysis / answers only.]`
          : `[MODE CONSTRAINT: ${mode} mode is read-only — do not propose or execute mutations; provide analysis / answers only.]`
        : rawInstructions;
    return {
      task,
      workspace: { status: workspace.status, name: workspace.name },
      project: { status: project.status, connectionType: project.connectionType, rootReference: project.rootReference },
      snapshot: buildPolicySnapshot(workspace.policy),
      instructions,
    };
  }

  private toRunInput(task: Task): RunInput {
    return {
      taskId: task.id,
      runId: "",
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      userId: task.createdBy,
      goal: task.goal,
      constraints: task.constraints,
      agentMode: task.agentMode,
      selectedModelMode: task.selectedModelMode,
      modelOverride:
        task.overrideProviderConnectionId && task.overrideModelIdentifier
          ? { providerConnectionId: task.overrideProviderConnectionId, modelIdentifier: task.overrideModelIdentifier }
          : null,
      workspaceInstructionVersion: null,
      policySnapshotId: "",
    };
  }

  private async latestApprovedPlan(taskId: string) {
    return this.prisma.taskPlan.findFirst({
      where: { taskId, status: "APPROVED" },
      orderBy: { version: "desc" },
    });
  }

  /** Tool names covered by a live APPROVED TASK-scope approval for this task. */
  private async activeTaskScopeToolNames(taskId: string): Promise<string[]> {
    const approvals = await this.prisma.approvalRequest.findMany({
      where: { taskId, requestedScope: "TASK", status: "APPROVED", toolCall: { isNot: null } },
      select: { toolCall: { select: { toolName: true } } },
    });
    return [...new Set(approvals.map((a) => a.toolCall?.toolName).filter((n): n is string => Boolean(n)))];
  }

  private async latestDraftPlan(taskId: string) {
    return this.prisma.taskPlan.findFirst({
      where: { taskId, status: "DRAFT" },
      orderBy: { version: "desc" },
    });
  }

  private async latestPlanAny(taskId: string) {
    const row = await this.prisma.taskPlan.findFirst({
      where: { taskId }, orderBy: { version: "desc" },
    });
    if (!row) return null;
    return {
      analysis: row.analysis,
      assumptions: [],
      affectedFiles: (row.affectedFiles as string[]) ?? [],
      steps: (row.steps as PlanStep[]) ?? [],
      risks: (row.risks as string[]) ?? [],
      verificationPlan: (row.verificationPlan as Array<{ command: string }>) ?? [],
    } satisfies PlanDraft;
  }

  private async currentRunOrThrow(taskId: string) {
    const run = await this.prisma.taskRun.findFirst({
      where: { taskId, state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
      orderBy: { runNumber: "desc" },
    });
    if (!run) throw errors.conflict("No active run for this task");
    return run;
  }

  /** Clean up orphaned RUNNING tool calls left by a previous crash. */
  private async cleanupOrphanedToolCalls(taskId: string, runId: string): Promise<void> {
    const orphans = await this.prisma.toolCall.findMany({
      where: { taskId, runId, status: "RUNNING" },
    });
    for (const orphan of orphans) {
      await this.prisma.toolCall.update({
        where: { id: orphan.id },
        data: {
          status: "FAILED",
          resultSummary: { failureCode: "ORPHANED", failureMessage: "Tool call was in progress when run was interrupted" },
          completedAt: new Date(),
        },
      });
      await this.events.publishAndEmit({
        taskId, runId,
        eventType: TASK_EVENT_TYPES.TOOL_FAILED,
        actorType: "SYSTEM",
        payload: { toolCallId: orphan.id, toolName: orphan.toolName, status: "FAILED", failureCode: "ORPHANED" },
      }).catch((err) => {
        this.logger.warn({ err }, "Failed to publish orphaned tool call event");
      });
    }
  }

  private async getCurrentState(taskId: string): Promise<TaskState> {
    const fresh = await this.prisma.task.findUnique({ where: { id: taskId }, select: { state: true } });
    return (fresh?.state as TaskState) ?? "EXECUTING";
  }

  private assertBudget(budget: Budget, deadline: number): void {
    if (Date.now() > deadline) {
      throw Object.assign(new Error("Run exceeded its wall-clock budget"), {
        name: FAILURE_CODES.MAX_DURATION_EXCEEDED,
      });
    }
    if (budget.toolCallsUsed >= budget.maxToolCalls) {
      throw Object.assign(new Error("Run exceeded maxToolCalls"), {
        name: FAILURE_CODES.MAX_TOOL_CALLS_EXCEEDED,
      });
    }
    if (budget.modelInvocationsUsed >= budget.maxModelInvocations) {
      throw Object.assign(new Error("Run exceeded max model invocations"), {
        name: "MAX_MODEL_INVOCATIONS_EXCEEDED",
      });
    }
  }

  private outcomeOf(x: RunOutcome | "PROCEED"): RunOutcome {
    switch (x) {
      case "PROCEED": return "FAILED"; // unreachable guard
      case "AWAITING_PLAN_APPROVAL":
      case "AWAITING_TOOL_APPROVAL":
      case "INTERRUPTED":
      case "COMPLETED":
      case "FAILED":
      case "CANCELLED":
        return x;
    }
  }

  private async recordAudit(
    userId: string,
    workspaceId: string | null,
    action: string,
    entityId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        workspaceId,
        action,
        entityType: "TASK",
        entityId,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  // ── OBSERVING: Tool output analysis and self-fix ──────────────

  private analyzeToolOutput(
    result: { status: string; output?: unknown; failureCode?: string; failureMessage?: string },
    _toolName: string,
  ): { hasError: boolean; errorType: string | null; errorMessage: string | null; suggestions: string[] } {
    const outputStr = typeof result.output === "string"
      ? result.output
      : typeof result.output === "object" && result.output !== null
        ? JSON.stringify(result.output)
        : "";

    const hasError = result.status !== "SUCCEEDED" || /error|failed|exception|ECONNREFUSED/i.test(outputStr);
    let errorType: string | null = null;
    let errorMessage: string | null = null;
    const suggestions: string[] = [];

    if (result.failureCode) {
      errorType = result.failureCode;
      errorMessage = result.failureMessage ?? null;
    } else if (hasError) {
      // Classify error from output content
      if (/type\s*error|typescript|TS\d{4}/i.test(outputStr)) {
        errorType = "TYPE_ERROR";
        errorMessage = this.extractErrorSnippet(outputStr);
        suggestions.push("Fix the TypeScript type error");
        suggestions.push("Check type definitions and casts");
      } else if (/syntax\s*error|unexpected\s*token/i.test(outputStr)) {
        errorType = "SYNTAX_ERROR";
        errorMessage = this.extractErrorSnippet(outputStr);
        suggestions.push("Fix the syntax error");
        suggestions.push("Check brackets, semicolons, and imports");
      } else if (/module\s*not\s*found|cannot\s*resolve|ENOENT/i.test(outputStr)) {
        errorType = "MODULE_NOT_FOUND";
        errorMessage = this.extractErrorSnippet(outputStr);
        suggestions.push("Install the missing dependency");
        suggestions.push("Check import paths");
      } else if (/lint|eslint|prettier/i.test(outputStr) && /error|warning/i.test(outputStr)) {
        errorType = "LINT_ERROR";
        errorMessage = this.extractErrorSnippet(outputStr);
        suggestions.push("Run the linter's auto-fix");
        suggestions.push("Fix lint violations manually");
      } else if (/test\s*failed|expect|assertion/i.test(outputStr)) {
        errorType = "TEST_FAILURE";
        errorMessage = this.extractErrorSnippet(outputStr);
        suggestions.push("Review the failing test");
        suggestions.push("Fix the implementation to match expected behavior");
      } else if (/ECONNREFUSED|ETIMEDOUT|network/i.test(outputStr)) {
        errorType = "NETWORK_ERROR";
        errorMessage = this.extractErrorSnippet(outputStr);
        suggestions.push("Check network connectivity");
        suggestions.push("Verify service URLs and ports");
      } else {
        errorType = "UNKNOWN_ERROR";
        errorMessage = outputStr.slice(0, 500);
      }
    }

    return { hasError, errorType, errorMessage, suggestions };
  }

  private extractErrorSnippet(output: string): string {
    // Extract the most relevant error line from output
    const lines = output.split("\n");
    const errorLines = lines.filter((l) => /error|failed|exception|unexpected/i.test(l));
    if (errorLines.length > 0) return errorLines.slice(0, 3).join("\n").slice(0, 500);
    return output.slice(0, 500);
  }

  private async attemptSelfFix(
    input: RunInput,
    runId: string,
    ctx: RunContext,
    budget: Budget,
    step: PlanStep,
    observation: { hasError: boolean; errorType: string | null; errorMessage: string | null; suggestions: string[] },
  ): Promise<"REPLANNED" | "CONTINUED"> {
    if (!observation.errorType || !observation.errorMessage) {
      return "CONTINUED";
    }

    // Use the SelfRecoveryEngine to classify and attempt recovery
    const failureType = this.recovery.classify(new Error(observation.errorMessage));
    const recoveryResult = await this.recovery.attemptRecovery(
      new Error(observation.errorMessage),
      async () => {
        // The actual recovery action is handled by replanning
        throw new Error("Recovery requires replanning");
      },
    );

    // If the recovery engine says we can recover, attempt replanning
    if (recoveryResult.recovered || recoveryResult.attempts.some((a) => a.action === "modify_and_retry")) {
      await this.events.publishAndEmit({
        taskId: input.taskId, runId,
        eventType: "SELF_FIX_ATTEMPTED",
        actorType: "SYSTEM",
        payload: {
          errorType: observation.errorType,
          errorMessage: observation.errorMessage?.slice(0, 300),
          failureType,
          recoveryAction: recoveryResult.attempts[0]?.action,
          suggestions: observation.suggestions,
          stepId: step.id,
        },
      });

      // Replan with the error context
      const replanResult = await this.replanAfterFailure(
        input, runId, ctx, budget,
        `Self-fix: ${observation.errorType} in step ${step.id}: ${observation.errorMessage?.slice(0, 200)}`,
      );
      if (replanResult !== "PROCEED") return "CONTINUED";
      return "REPLANNED";
    }

    return "CONTINUED";
  }

  /**
   * Track token usage for a model call.
   * Records usage in the database for cost analysis.
   */
  async trackTokenUsage(input: {
    userId: string;
    workspaceId?: string;
    taskId?: string;
    providerType: string;
    modelIdentifier: string;
    inputTokens: number;
    outputTokens: number;
    stage?: string;
    traceId?: string;
  }): Promise<void> {
    const totalTokens = input.inputTokens + input.outputTokens;
    const estimatedCost = this.estimateCost(input.providerType, input.modelIdentifier, input.inputTokens, input.outputTokens);

    // Also update trace tokenUsage so trace reflects cost
    if (input.traceId && this.traceBuilder) {
      const trace = this.traceBuilder.getTrace(input.traceId);
      if (trace) {
        trace.tokenUsage.prompt += input.inputTokens;
        trace.tokenUsage.completion += input.outputTokens;
        trace.tokenUsage.total += totalTokens;
        trace.tokenUsage.estimatedCost += estimatedCost;
      }
    }

    try {
      await this.prisma.usageRecord.create({
        data: {
          id: randomUUID(),
          userId: input.userId,
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          providerType: input.providerType,
          modelIdentifier: input.modelIdentifier,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          totalTokens,
          estimatedCost,
          stage: input.stage,
        },
      });
    } catch (err) {
      // Don't fail the run if usage tracking fails
      this.logger.warn({ err }, "Failed to track token usage");
    }
  }

  /**
   * Estimate cost based on provider and model.
   * Returns cost in USD.
   */
  private estimateCost(providerType: string, modelIdentifier: string, inputTokens: number, outputTokens: number): number {
    // Pricing per 1M tokens (USD) - as of 2024
    const pricing: Record<string, { input: number; output: number }> = {
      // OpenAI models
      "gpt-4o": { input: 2.50, output: 10.00 },
      "gpt-4o-mini": { input: 0.15, output: 0.60 },
      "gpt-4-turbo": { input: 10.00, output: 30.00 },
      "gpt-3.5-turbo": { input: 0.50, output: 1.50 },
      // Anthropic models
      "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00 },
      "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
      "claude-3-opus-20240229": { input: 15.00, output: 75.00 },
      // Google models
      "gemini-1.5-pro": { input: 1.25, output: 5.00 },
      "gemini-1.5-flash": { input: 0.075, output: 0.30 },
    };

    const modelPricing = pricing[modelIdentifier] ?? { input: 3.00, output: 15.00 }; // Default to Claude 3.5 Sonnet pricing
    const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
    return inputCost + outputCost;
  }

  // ── Session persistence helpers ──────────────────────────────

  private async createRunSession(input: RunInput, runId: string): Promise<void> {
    if (!this.sessionEngine) return;
    const session = await this.sessionEngine.createSession({
      name: `Task ${input.taskId} - Run ${runId}`,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      model: input.modelOverride?.modelIdentifier,
      provider: input.modelOverride?.providerConnectionId,
    });
    this.activeSessionId = session.id;
    await this.sessionEngine.addMessage(session.id, {
      role: "system",
      content: `Run started for task: ${input.goal}`,
    });
  }

  private async recordToolCallToSession(
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    success: boolean,
    duration: number,
  ): Promise<void> {
    if (!this.sessionEngine || !this.activeSessionId) return;
    await this.sessionEngine.addToolCall(this.activeSessionId, {
      name: toolName,
      input,
      output,
      success,
      duration,
    });
  }

  private async recordPlanToSession(planContent: string): Promise<void> {
    if (!this.sessionEngine || !this.activeSessionId) return;
    await this.sessionEngine.addPlan(this.activeSessionId, {
      content: planContent,
      approved: false,
    });
  }

  private async archiveRunSession(): Promise<void> {
    if (!this.sessionEngine || !this.activeSessionId) return;
    await this.sessionEngine.archiveSession(this.activeSessionId);
    this.activeSessionId = null;
  }
}

function mapExtensionRiskLevel(level: string): "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL" {
  switch (level) {
    case "LOW": return "READ";
    case "MEDIUM": return "WRITE";
    case "HIGH": return "DESTRUCTIVE";
    case "CRITICAL": return "EXTERNAL";
    default: return "WRITE";
  }
}

function resolveCancel(from: TaskState): void {
  if (isTerminalState(from) || from === "INTERRUPTED") {
    throw errors.conflict(`Task in state ${from} cannot be cancelled`);
  }
  if (!isActiveRunState(from) && from !== "QUEUED") {
    throw errors.conflict(`Task in state ${from} cannot be cancelled`);
  }
}

const FAILURE_CODE_NAMES = new Set<string>(Object.values(FAILURE_CODES));

interface RunContext {
  task: Task;
  workspace: { status: "ACTIVE" | "ARCHIVED"; name: string };
  project: { status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE"; connectionType: "CLOUD" | "LOCAL_BRIDGE"; rootReference: string };
  snapshot: PolicySnapshot;
  instructions: string | null;
  projectAnalysis?: unknown | null;
}
