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
      '"acceptanceCriteria": string[], "toolName"?: string, "toolInput"?: object}], "risks": string[],',
      '"verificationPlan": [{"command": string, "asserts": string[]}]}.',
      "Steps must be ordered and independently verifiable.",
      "Every step's acceptanceCriteria lists 1-3 short, objectively checkable claims (specific",
      "file, behavior, or output) that must hold once the step completes — never vague wording.",
      "Each verificationPlan command's asserts must list the exact acceptanceCriteria text that",
      "running the command proves; every acceptanceCriteria must be asserted by at least one",
      "command. Unasserted criteria fail verification and force a replan.",
      "verificationPlan commands run inside the project root with the working directory",
      "already set: return directly runnable commands only (e.g. `npm test`, `git diff --stat`).",
      "Never include cd, <placeholders>, or angle-bracket tokens in verification commands.",
      "toolName must be an exact registered tool (filesystem.read/write/list/rename/delete,",
      "git.status/diff/log/commit/branch/blame/merge/stash, terminal.run, terminal.run_readonly)",
      "or omitted entirely — never invent tool names.",
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
            return linkCriteriaToAsserts(parsed.data);
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

/** Words that carry no evidence when matching criteria to verification claims. */
const LINK_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "for", "to", "in",
  "on", "at", "by", "with", "and", "or", "not", "it", "its", "this", "that", "as",
  "from", "into", "than", "then", "per", "via", "when", "once",
]);

/**
 * Significant tokens for coverage linking: lowercase, split on punctuation
 * except `.`, `+`, `-` (so `hello.txt`, `dry-run`, `c++` stay intact), trailing
 * `.`/`-` trimmed, single non-numeric tokens dropped, stopwords removed.
 */
function linkTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.+-]+/)
    .map((t) => t.replace(/^[.-]+/, "").replace(/[.-]+$/, ""))
    .filter((t) => (t.length >= 2 || /\d/.test(t)) && !LINK_STOPWORDS.has(t));
}

/**
 * Spec-driven repair for paraphrased asserts: the coverage gate
 * (VerificationEngine.uncoveredCriteria) matches step acceptanceCriteria to
 * verificationPlan.asserts by exact normalized text, but models — especially
 * small local ones — often paraphrase ("The output is 4") instead of copying
 * the criterion verbatim, which would falsely mark criteria uncovered and
 * force an approval-replan loop.
 *
 * Appends each unclaimed criterion (original text) to the verification entry
 * whose command+asserts tokens overlap it most, requiring ≥2 shared tokens or
 * ≥50% of the criterion's tokens; numeric-token matches win ties. Criteria
 * with no plausible entry stay uncovered so the gate still fires. Idempotent;
 * only affects plans that declare a verificationPlan (legacy plans and
 * auto-inferred command sets are untouched).
 */
export function linkCriteriaToAsserts<P extends {
  steps: Array<{ acceptanceCriteria?: string[] | null }>;
  verificationPlan: Array<{ command: string; asserts?: string[] | null }>;
}>(plan: P): P {
  const entries = plan.verificationPlan ?? [];
  if (!plan.steps?.length || entries.length === 0) return plan;

  const normalize = (t: string): string => t.trim().replace(/\s+/g, " ").toLowerCase();
  const claimed = new Set<string>();
  for (const entry of entries) {
    for (const assertText of entry.asserts ?? []) {
      const key = normalize(assertText);
      if (key) claimed.add(key);
    }
  }

  const unclaimed: string[] = [];
  const seen = new Set<string>();
  for (const step of plan.steps) {
    for (const criterion of step.acceptanceCriteria ?? []) {
      const key = normalize(criterion);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!claimed.has(key)) unclaimed.push(criterion);
    }
  }
  if (unclaimed.length === 0) return plan;

  // Score candidates from the ORIGINAL entries so earlier links cannot skew later ones.
  const candidateTokens = entries.map(
    (entry) => new Set(linkTokens(`${entry.command} ${(entry.asserts ?? []).join(" ")}`)),
  );
  const repaired = entries.map((entry) => ({ ...entry, asserts: [...(entry.asserts ?? [])] }));

  let changed = false;
  for (const criterion of unclaimed) {
    const critTokens = linkTokens(criterion);
    if (critTokens.length === 0) continue;
    const critNums = critTokens.filter((t) => /\d/.test(t));
    let best = -1;
    let bestScore = 0;
    let bestNums = -1;
    for (let i = 0; i < candidateTokens.length; i++) {
      const candidate = candidateTokens[i]!;
      let matched = 0;
      let nums = 0;
      for (const token of critTokens) {
        if (candidate.has(token)) {
          matched += 1;
          if (critNums.includes(token)) nums += 1;
        }
      }
      if (matched < 2 && matched * 2 < critTokens.length) continue;
      if (matched > bestScore || (matched === bestScore && nums > bestNums)) {
        best = i;
        bestScore = matched;
        bestNums = nums;
      }
    }
    if (best < 0) continue;
    const target = repaired[best]!;
    if (target.asserts!.length >= 6) continue; // schema cap on asserts
    target.asserts!.push(criterion);
    changed = true;
  }

  return changed ? { ...plan, verificationPlan: repaired } : plan;
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
