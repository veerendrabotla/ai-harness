import { fenceUntrusted, redactText } from "@ai-harness/shared";
import type { ContextManifestDto, ContextManifestItem } from "@ai-harness/contracts";

/**
 * Context Engine (AGENT_RUNTIME.md §10).
 * Deterministic priority assembly with a hard byte budget. Security/system
 * instructions and the task goal are never dropped; lower-priority items are
 * omitted first and every omission is recorded in the manifest.
 */

export const CONTEXT_PRIORITY = {
  SYSTEM_INSTRUCTIONS: 1,
  WORKSPACE_INSTRUCTIONS: 2,
  TASK_GOAL: 3,
  CONSTRAINTS: 4,
  PROJECT_ANALYSIS: 5,
  CURRENT_PLAN: 6,
  STEP_FILES: 7,
  DEPENDENCY_CONFIG: 8,
  RECENT_TOOL_RESULTS: 9,
  GIT_DIFF: 10,
  PROJECT_STRUCTURE: 11,
  REPO_MAP: 12,
  SURGICAL_CONTEXT: 8,
  PRIOR_RUN_SUMMARY: 13,
  MCP_RESOURCES: 14,
} as const;

export interface ContextCandidate {
  sourceType: keyof typeof CONTEXT_PRIORITY | string;
  identifier: string;
  inclusionReason: string;
  content: string;
}

export interface AssembleInput {
  systemInstructions: string;
  workspaceInstructions?: string | null;
  goal: string;
  constraints?: string | null;
  currentPlanSummary?: string | null;
  stepFiles?: Array<{ path: string; note?: string }> | null;
  dependencyConfig?: string | null;
  mcpResources?: string | null;
  recentToolResults?: Array<{ id: string; summary: string }> | undefined;
  priorRunSummary?: string | null;
  projectAnalysis?: ProjectAnalysisContext | null;
  projectStructure?: string | null;
  gitDiff?: string | null;
  repoMap?: string | null;
  surgicalContext?: string | null;
  budgetBytes?: number;
}

export interface ProjectAnalysisContext {
  projectType: string;
  languages: Array<{ name: string; fileCount: number }>;
  frameworks: Array<{ name: string; type: string }>;
  packageManager: { name: string; workspaces: boolean };
  scripts: Array<{ name: string; command: string; purpose: string }>;
  conventions: { tsConfig: boolean; moduleSystem: string };
  testSetup: { framework: string | null; hasTests: boolean };
  databaseInfo: { orm: string | null } | null;
  entryPoints: string[];
  envRequirements: Array<{ variable: string; required: boolean }>;
}

export interface AssembledContext {
  manifest: ContextManifestDto;
  promptText: string;
}

const DEFAULT_BUDGET_BYTES = 120_000;

function byteSize(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function toItem(c: ContextCandidate): ContextManifestItem & { rank: number; content: string } {
  return {
    sourceType: c.sourceType,
    identifier: c.identifier,
    inclusionReason: c.inclusionReason,
    sizeBytes: byteSize(c.content),
    redactionStatus: /REDACTED/.test(redactText(c.content)) ? "REDACTED" : "CLEAN",
    rank: CONTEXT_PRIORITY[c.sourceType as keyof typeof CONTEXT_PRIORITY] ?? 50,
    content: redactText(c.content),
  };
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const budget = input.budgetBytes ?? DEFAULT_BUDGET_BYTES;

  const candidates = [
    toItem({
      sourceType: "SYSTEM_INSTRUCTIONS",
      identifier: "runtime/system",
      inclusionReason: "Security boundary instructions; always included",
      content: input.systemInstructions,
    }),
    ...(input.workspaceInstructions
      ? [
          toItem({
            sourceType: "WORKSPACE_INSTRUCTIONS",
            identifier: "workspace/instructions",
            inclusionReason: "Workspace-level project instructions",
            content: input.workspaceInstructions,
          }),
        ]
      : []),
    toItem({
      sourceType: "TASK_GOAL",
      identifier: "task/goal",
      inclusionReason: "The user objective being executed",
      content: `Goal:\n${input.goal}`,
    }),
    ...(input.constraints
      ? [
          toItem({
            sourceType: "CONSTRAINTS",
            identifier: "task/constraints",
            inclusionReason: "Explicit user constraints",
            content: `Constraints:\n${input.constraints}`,
          }),
        ]
      : []),
    ...(input.projectAnalysis
      ? [
          toItem({
            sourceType: "PROJECT_ANALYSIS",
            identifier: "project/intelligence",
            inclusionReason: "Repository intelligence: frameworks, languages, structure, and conventions",
            content: formatProjectAnalysis(input.projectAnalysis),
          }),
        ]
      : []),
    ...(input.currentPlanSummary
      ? [
          toItem({
            sourceType: "CURRENT_PLAN",
            identifier: "plan/current",
            inclusionReason: "Approved plan steps guiding execution",
            content: input.currentPlanSummary,
          }),
        ]
      : []),
    ...(input.stepFiles?.length
      ? [
          toItem({
            sourceType: "STEP_FILES",
            identifier: "plan/step-files",
            inclusionReason: "Files referenced by the current plan steps",
            content: input.stepFiles
              .map((f) => `- ${f.path}${f.note ? ` — ${f.note}` : ""}`)
              .join("\n"),
          }),
        ]
      : []),
    ...(input.dependencyConfig
      ? [
          toItem({
            sourceType: "DEPENDENCY_CONFIG",
            identifier: "project/dependency-config",
            inclusionReason: "Dependency manifest with scripts and versions (package.json)",
            content: input.dependencyConfig,
          }),
        ]
      : []),
    ...(input.recentToolResults?.map((r) =>
      toItem({
        sourceType: "RECENT_TOOL_RESULTS",
        identifier: r.id,
        inclusionReason: "Recent observation from a completed tool call",
        content: r.summary,
      }),
    ) ?? []),
    ...(input.gitDiff
      ? [
          toItem({
            sourceType: "GIT_DIFF",
            identifier: "git/diff",
            inclusionReason: "Current uncommitted changes for context",
            content: input.gitDiff,
          }),
        ]
      : []),
    ...(input.projectStructure
      ? [
          toItem({
            sourceType: "PROJECT_STRUCTURE",
            identifier: "project/structure",
            inclusionReason: "Project file tree and directory layout",
            content: input.projectStructure,
          }),
        ]
      : []),
    ...(input.repoMap
      ? [
          toItem({
            sourceType: "REPO_MAP",
            identifier: "project/repo-map",
            inclusionReason: "Ranked file listing of the project (Aider-style repo map)",
            content: input.repoMap,
          }),
        ]
      : []),
    ...(input.surgicalContext
      ? [
          toItem({
            sourceType: "SURGICAL_CONTEXT",
            identifier: "project/surgical-target",
            inclusionReason: "Agentic search: primary target file for this edit (Lovable pattern)",
            content: input.surgicalContext,
          }),
        ]
      : []),
    ...(input.priorRunSummary
      ? [
          toItem({
            sourceType: "PRIOR_RUN_SUMMARY",
            identifier: "runs/prior",
            inclusionReason: "Summary of previous runs for this task",
            content: input.priorRunSummary,
          }),
        ]
      : []),
    ...(input.mcpResources
      ? [
          toItem({
            sourceType: "MCP_RESOURCES",
            identifier: "mcp/resources",
            inclusionReason: "Resources exposed by workspace MCP servers",
            content: input.mcpResources,
          }),
        ]
      : []),
  ];

  // Rank ascending (1 = highest priority), then pack until the budget is exhausted.
  const ordered = [...candidates].sort((a, b) => a.rank - b.rank);
  const included: typeof ordered = [];
  const omitted: ContextManifestItem[] = [];
  let used = 0;

  for (const item of ordered) {
    const mandatory = item.rank <= CONTEXT_PRIORITY.TASK_GOAL;
    if (!mandatory && used + item.sizeBytes > budget) {
      omitted.push({
        sourceType: item.sourceType,
        identifier: item.identifier,
        inclusionReason: item.inclusionReason,
        sizeBytes: item.sizeBytes,
        redactionStatus: "OMITTED",
      });
      continue;
    }
    included.push(item);
    used += item.sizeBytes;
  }

  const manifest: ContextManifestDto = {
    items: included.map(({ rank: _rank, content: _content, ...rest }) => rest),
    omitted,
    budgetBytes: budget,
    usedBytes: used,
  };

  // Untrusted sources are fenced with injection defenses; only the system
  // instruction header stays outside fences.
  const promptText = included
    .map((i) =>
      i.sourceType === "SYSTEM_INSTRUCTIONS"
        ? i.content
        : fenceUntrusted(i.identifier, i.content),
    )
    .join("\n\n");
  return { manifest, promptText };
}

function formatProjectAnalysis(analysis: ProjectAnalysisContext): string {
  const lines: string[] = ["## Project Intelligence"];

  lines.push(`\nType: ${analysis.projectType}`);
  lines.push(`Package Manager: ${analysis.packageManager.name}${analysis.packageManager.workspaces ? " (workspaces)" : ""}`);

  if (analysis.languages.length > 0) {
    lines.push(`\nLanguages: ${analysis.languages.map((l) => `${l.name} (${l.fileCount} files)`).join(", ")}`);
  }

  if (analysis.frameworks.length > 0) {
    lines.push(`Frameworks: ${analysis.frameworks.map((f) => `${f.name} (${f.type})`).join(", ")}`);
  }

  if (analysis.scripts.length > 0) {
    lines.push(`\nAvailable scripts:`);
    for (const s of analysis.scripts) {
      lines.push(`  - ${s.name}: ${s.command} [${s.purpose}]`);
    }
  }

  if (analysis.conventions.tsConfig) lines.push(`\nTypeScript: enabled (${analysis.conventions.moduleSystem})`);

  if (analysis.testSetup.hasTests) {
    lines.push(`Tests: ${analysis.testSetup.framework ?? "configured"} (${analysis.testSetup.hasTests ? "has tests" : "no tests found"})`);
  }

  if (analysis.databaseInfo) {
    lines.push(`Database: ${analysis.databaseInfo.orm ?? "detected"}`);
  }

  if (analysis.entryPoints.length > 0) {
    lines.push(`\nEntry points: ${analysis.entryPoints.join(", ")}`);
  }

  if (analysis.envRequirements.length > 0) {
    lines.push(`\nRequired environment variables:`);
    for (const e of analysis.envRequirements.filter((e) => e.required)) {
      lines.push(`  - ${e.variable} (required)`);
    }
  }

  return lines.join("\n");
}

/** Rough token estimate (≈4 bytes/token) for persistence on context_packages. */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

// ── Context Compaction (Codex-inspired) ─────────────────

/**
 * Codex-style context compaction — when the conversation history grows large,
 * summarize older messages so the model sees a compact handoff instead of
 * the full raw history. Triggers at ~60% of the context window (like Codex's
 * 180K–244K / 200K threshold). Prune-before-compact is more effective than
 * raw summarization alone.
 *
 * Usage: if (shouldCompact(usedTokens, modelLimit)) { compact(...) }
 */

export const COMPACTION_THRESHOLD_RATIO = 0.6;

export function shouldCompact(usedTokens: number, modelContextLimit: number): boolean {
  return usedTokens / modelContextLimit >= COMPACTION_THRESHOLD_RATIO;
}

export interface CompactedContext {
  summary: string;
  retainedMessages: string[];
  forgottenCount: number;
  summaryOffset: number;
}

/**
 * Prune-then-summarize compaction.
 * Keeps the most recent `protectTokens` worth of messages verbatim,
 * and summarizes everything older into a single handoff string.
 * The handoff is phrased as "how to continue" not "what happened"
 * (Codex pattern — focuses the model on next steps).
 */
export function compactContext(
  messages: string[],
  opts: {
    protectTokens?: number;
    budgetTokens?: number;
  } = {},
): CompactedContext {
  const protectTokens = opts.protectTokens ?? 40_000;
  const budgetTokens = opts.budgetTokens ?? 4_000;

  if (messages.length === 0) {
    return { summary: "", retainedMessages: [], forgottenCount: 0, summaryOffset: 0 };
  }

  // Estimate tokens per message (≈4 chars/token)
  const msgTokens = messages.map((m) => Math.ceil(m.length / 4));

  // Find split point: protect the most recent `protectTokens` worth
  let retainedStart = messages.length;
  let accumulated = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += msgTokens[i]!;
    if (accumulated >= protectTokens) {
      retainedStart = i;
      break;
    }
    if (i === 0) retainedStart = 0;
  }

  if (retainedStart === 0) {
    // Nothing to compact — all fits in protected window
    return { summary: "", retainedMessages: messages, forgottenCount: 0, summaryOffset: 0 };
  }

  const forgotten = messages.slice(0, retainedStart);
  const retained = messages.slice(retainedStart);

  // Build handoff summary from forgotten messages (extract key facts)
  const summary = buildHandoffSummary(forgotten, budgetTokens);

  return {
    summary,
    retainedMessages: retained,
    forgottenCount: forgotten.length,
    summaryOffset: retainedStart,
  };
}

function buildHandoffSummary(messages: string[], budgetTokens: number): string {
  const budgetChars = budgetTokens * 4;
  // Extract meaningful lines (skip pure fences, tool noise)
  const meaningful: string[] = [];
  for (const msg of messages) {
    const lines = msg.split("\n").filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith("UNTRUSTED_")) return false;
      if (t.match(/^[-=]{3,}$/)) return false;
      return true;
    });
    meaningful.push(...lines);
  }

  // Take a representative sample: first message (goal) + last messages before cutoff + key events
  const sampled: string[] = [];
  if (meaningful.length > 0) {
    // Always include the task goal (first meaningful block)
    sampled.push(meaningful[0]!);
  }
  // Include any lines mentioning state transitions, tool calls, or decisions
  for (const line of meaningful) {
    if (/plan|tool|decision|error|approved|rejected|checkpoint|verification/i.test(line)) {
      if (!sampled.includes(line)) sampled.push(line);
    }
  }
  // Include last few meaningful lines before cutoff
  for (const line of meaningful.slice(-5)) {
    if (!sampled.includes(line)) sampled.push(line);
  }

  let summary = `[Context Handoff — ${meaningful.length} earlier messages summarized. Continue from here.]\n`;
  summary += sampled.join("\n");

  // Truncate to budget
  if (summary.length > budgetChars) {
    summary = summary.slice(0, budgetChars - 20) + "\n[...truncated]";
  }

  return summary;
}
