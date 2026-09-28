import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { planDraftSchema, type PlanDraft } from "@ai-harness/contracts";
import { FAILURE_CODES, TASK_EVENT_TYPES } from "@ai-harness/domain";
import { assembleContext, compactContext, shouldCompact } from "@ai-harness/context-engine";
import {
  AdapterError,
  extractJson,
  type ModelAdapter,
  type ModelRequest,
} from "@ai-harness/model-adapters";
import type { RouteDecision } from "./model-router.js";

/** Conservative planning-context window shared across routed providers. */
const PLANNING_CONTEXT_LIMIT_TOKENS = 100_000;

export const RUNTIME_SYSTEM_INSTRUCTIONS = [
  "You are the planning stage of AI Harness, a controlled software engineering agent.",
  "You operate inside a policy-governed harness. You have no direct authority:",
  "every action you propose is validated, permission-checked and may require human approval.",
  "Never attempt to bypass policies, exfiltrate secrets, or propose destructive actions without explicit justification.",
].join(" ");

/**
 * Planner (AGENT_RUNTIME.md §5).
 * Produces a validated structured plan; write actions during planning are impossible
 * because planning has no tool authority at all.
 */
export class Planner {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Prior-run history for the task, formatted as one message per run and
   * compacted (Codex-style prune-then-summarize) when it approaches the
   * planning context budget (context-engine §Compaction).
   */
  private async priorRunSummary(taskId: string, currentRunId: string): Promise<string | null> {
    const runs = await this.prisma.taskRun.findMany({
      where: { taskId, ...(currentRunId ? { id: { not: currentRunId } } : {}) },
      orderBy: { runNumber: "asc" },
      select: { runNumber: true, state: true, failureCode: true, failureMessage: true },
    });
    if (runs.length === 0) return null;
    const messages = runs.map((r) =>
      r.failureMessage
        ? `Run #${r.runNumber} ended ${r.state}${r.failureCode ? ` [${r.failureCode}]` : ""}: ${r.failureMessage}`
        : `Run #${r.runNumber} ended ${r.state}.`,
    );
    const usedTokens = messages.reduce((a, m) => a + Math.ceil(m.length / 4), 0);
    if (!shouldCompact(usedTokens, PLANNING_CONTEXT_LIMIT_TOKENS)) {
      return messages.join("\n");
    }
    const compacted = compactContext(messages, { protectTokens: 8_000, budgetTokens: 2_000 });
    if (!compacted.summary) return compacted.retainedMessages.join("\n");
    return [
      "Prior run history was compacted (how to continue from here):",
      compacted.summary,
      ...compacted.retainedMessages,
      compacted.forgottenCount > 0 ? `(${compacted.forgottenCount} older run record(s) folded into the summary)` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  async createPlan(input: {
    taskId: string;
    runId: string;
    goal: string;
    constraints: string | null;
    workspaceInstructions: string | null;
    adapter: ModelAdapter;
    route: RouteDecision;
    fallbackRoutes?: RouteDecision[];
    getAdapter?: (providerType: RouteDecision["providerConnection"]["providerType"]) => ModelAdapter | undefined;
    fallbacks?: Array<{ route: RouteDecision; adapter: ModelAdapter }>;
    revisionInstruction?: string | null;
    previousPlan?: PlanDraft | null;
    streamDeltas?: boolean;
    onDelta?: ((text: string) => void) | undefined;
    publish: (input: {
      taskId: string;
      runId?: string | null;
      eventType: string;
      actorType: "SYSTEM" | "AGENT" | "USER" | "TOOL" | "BRIDGE";
      payload?: Record<string, unknown>;
    }) => Promise<void>;
    maxOutputTokens?: number;
  }): Promise<PlanDraft> {
    const priorRunSummary = await this.priorRunSummary(input.taskId, input.runId).catch(() => null);
    const stepFiles = input.previousPlan?.affectedFiles?.length
      ? input.previousPlan.affectedFiles.map((path) => ({ path, note: "affected by previous plan" }))
      : null;
    const context = assembleContext({
      systemInstructions: RUNTIME_SYSTEM_INSTRUCTIONS,
      workspaceInstructions: input.workspaceInstructions,
      goal: input.goal,
      constraints: input.constraints,
      currentPlanSummary: input.previousPlan ? JSON.stringify(input.previousPlan) : null,
      stepFiles,
      priorRunSummary,
    });

    const objective = [
      "Produce an implementation plan for the following development task.",
      "",
      `TASK GOAL:\n${input.goal}`,
      input.constraints ? `\nCONSTRAINTS:\n${input.constraints}` : "",
      input.revisionInstruction
        ? `\nREVISION INSTRUCTION from the human reviewer:\n${input.revisionInstruction}`
        : "",
      input.previousPlan ? "\nThe previous plan version is included in context; supersede it." : "",
      "",
      'Return JSON with exactly these fields: {"analysis": string, "assumptions": string[],',
      '"affectedFiles": string[], "steps": [{"id": string, "title": string, "detail": string,',
      '"toolName"?: string, "toolInput"?: object}], "risks": string[],',
      '"verificationPlan": [{"command": string}]}.',
      "Steps must be ordered and independently verifiable.",
    ].join("\n");

    const request: ModelRequest = {
      stage: "PLANNING",
      modelIdentifier: input.route.modelIdentifier,
      systemInstructions: RUNTIME_SYSTEM_INSTRUCTIONS,
      userObjective: objective,
      contextItems: context.promptText,
      responseSchemaName: "PLAN",
      maxOutputTokens: input.maxOutputTokens ?? 4096,
    };

    await input.publish({
      taskId: input.taskId,
      runId: input.runId,
      eventType: TASK_EVENT_TYPES.MODEL_ROUTE_SELECTED,
      actorType: "SYSTEM",
      payload: {
        routeId: input.route.routeId,
        providerType: input.route.providerConnection.providerType,
        modelIdentifier: input.route.modelIdentifier,
        usedFallback: input.route.usedFallback,
        reason: input.route.reason,
      },
    });

    let lastError: Error = new Error("Planning did not produce a valid plan");

    // Build fallback candidate list so retryable runtime failures can try the next route
    const candidates: Array<{ route: RouteDecision; adapter: ModelAdapter }> = [
      { route: input.route, adapter: input.adapter },
    ];
    if (input.fallbacks?.length) {
      candidates.push(...input.fallbacks);
    } else if (input.fallbackRoutes?.length) {
      for (const r of input.fallbackRoutes) {
        const a = input.getAdapter?.(r.providerConnection.providerType);
        if (a) candidates.push({ route: r, adapter: a });
        else if (r.providerConnection.providerType === input.route.providerConnection.providerType) {
          // fallback to same adapter if provider type matches and no resolver
          candidates.push({ route: r, adapter: input.adapter });
        }
      }
    }

    // One transient retry inside the runtime budget (AGENT_RUNTIME.md §16), plus fallback iteration on retryable errors.
    outer: for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const candidate = candidates[cIdx]!;
      const candidateRequest: ModelRequest = {
        ...request,
        modelIdentifier: candidate.route.modelIdentifier,
      };
      if (cIdx > 0) {
        await input.publish({
          taskId: input.taskId,
          runId: input.runId,
          eventType: TASK_EVENT_TYPES.MODEL_ROUTE_SELECTED,
          actorType: "SYSTEM",
          payload: {
            routeId: candidate.route.routeId,
            providerType: candidate.route.providerConnection.providerType,
            modelIdentifier: candidate.route.modelIdentifier,
            usedFallback: true,
            reason: candidate.route.reason,
            fallbackAttempt: cIdx,
          },
        });
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await candidate.adapter.generate(candidateRequest, candidate.route.providerConnection);
          // Recorded for every completed invocation (even when the draft fails
          // schema validation) so buildRunBudget restores the true count.
          await input.publish({
            taskId: input.taskId,
            runId: input.runId,
            eventType: TASK_EVENT_TYPES.MODEL_INVOCATION_RECORDED,
            actorType: "AGENT",
            payload: {
              stage: "PLANNING",
              providerType: response.providerType,
              modelIdentifier: response.modelIdentifier,
              finishReason: response.finishReason,
              usage: response.usage,
              attempt,
              routeId: candidate.route.routeId,
              fallbackUsed: cIdx > 0,
            },
          });
          const parsed = planDraftSchema.safeParse(extractJson(response.text));
          if (parsed.success) {
            return parsed.data;
          }
          lastError = new Error(
            `Plan schema validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          );
          // Validation failure is not retryable across fallbacks in the same way; try next candidate if available
          // but only after exhausting attempts for this candidate
          if (attempt === 1 && cIdx < candidates.length - 1) break;
        } catch (err) {
          lastError =
            err instanceof AdapterError && !err.retryable
              ? err
              : err instanceof Error
                ? err
                : new Error(String(err));
          if (err instanceof AdapterError && !err.retryable) break outer;
          const isRetryable = err instanceof AdapterError ? err.retryable : true;
          if (isRetryable && cIdx < candidates.length - 1) {
            // Retryable failure with a fallback available -> try next fallback immediately
            break;
          }
          if (attempt === 1 && cIdx < candidates.length - 1) break;
          if (isRetryable && attempt === 0) continue;
        }
      }
    }

    const failure = new Error(lastError.message);
    failure.name = FAILURE_CODES.PLAN_VALIDATION_FAILED;
    throw failure;
  }
}

/** Persists a validated plan draft as the next immutable version. */
export async function persistNewPlanVersion(
  prisma: PrismaClient,
  input: {
    taskId: string;
    runId: string;
    plan: PlanDraft;
    supersedePrevious: boolean;
  },
): Promise<{ id: string; version: number }> {
  return prisma.$transaction(async (tx) => {
    if (input.supersedePrevious) {
      await tx.taskPlan.updateMany({
        where: { taskId: input.taskId, status: "DRAFT" },
        data: { status: "SUPERSEDED" },
      });
    }
    const maxVersion = await tx.taskPlan.aggregate({
      where: { taskId: input.taskId },
      _max: { version: true },
    });
    const version = (maxVersion._max.version ?? 0) + 1;
    const created = await tx.taskPlan.create({
      data: {
        taskId: input.taskId,
        runId: input.runId,
        version,
        analysis: input.plan.analysis,
        affectedFiles: input.plan.affectedFiles as Prisma.InputJsonValue,
        steps: input.plan.steps as Prisma.InputJsonValue,
        risks: input.plan.risks as Prisma.InputJsonValue,
        verificationPlan: input.plan.verificationPlan as Prisma.InputJsonValue,
        status: "DRAFT",
      },
    });
    return { id: created.id, version };
  });
}
