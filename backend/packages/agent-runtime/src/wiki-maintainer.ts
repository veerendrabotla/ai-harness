import type { Logger } from "@ai-harness/shared";
import type { PrismaClient } from "@prisma/client";
import type { ToolHarness, ExecutionEnvironment } from "@ai-harness/tool-harness";
import type { HookContext } from "./orchestrator.js";

/**
 * Repo Wiki — living documentation under `.aiharness/wiki/`, auto-maintained by
 * runs. The orchestrator fires `afterComplete`; this is the hook bus's first
 * production subscriber (see runtime.ts).
 *
 * Ownership model (documented in docs/guides/wiki.md):
 *  - `index.md` + `changelog.md` are GENERATED files — regenerated/merged here.
 *  - `pages/*.md` are authored by the agent (pre-approved write zone; see
 *    permission-engine evaluate.ts) and linked from the generated index.
 *
 * Opt-in: maintenance only runs when `.aiharness/wiki/` already exists in the
 * project root (absent → skip silently). Every operation is best-effort —
 * failures log a warning and never affect the run (fireHooks also guards).
 */

export const WIKI_DIR = ".aiharness/wiki";
export const WIKI_CHANGELOG_PATH = `${WIKI_DIR}/changelog.md`;
export const WIKI_INDEX_PATH = `${WIKI_DIR}/index.md`;
export const WIKI_PAGES_DIR = `${WIKI_DIR}/pages`;
export const MAX_CHANGELOG_ENTRIES = 50;

const RUN_MARKER_RE = /<!-- run:[^>]+ -->/g;

export interface WikiRunFacts {
  runId: string;
  goal: string;
  completedAt: Date;
  stepCount: number;
  verificationPassed: number;
  verificationTotal: number;
  affectedFiles: string[];
}

export interface WikiRecentRun {
  completedAt: Date;
  goal: string;
}

export interface WikiRoot {
  root: string;
  environment: ExecutionEnvironment;
  taskId: string;
  runId: string;
}

export interface WikiDeps {
  getProject(projectId: string): Promise<{ name: string; rootReference: string; environment: ExecutionEnvironment } | null>;
  getRunFacts(taskId: string, runId: string, payload: Record<string, unknown>): Promise<WikiRunFacts | null>;
  getRecentRuns(projectId: string): Promise<WikiRecentRun[]>;
  listWiki(w: WikiRoot, path: string): Promise<string[]>;
  readWiki(w: WikiRoot, path: string): Promise<string | null>;
  writeWiki(w: WikiRoot, path: string, content: string): Promise<void>;
}

/** True when `p` is inside the repo-wiki zone (forward-slash normalized, no traversal). */
export function isWikiPath(p: string | undefined): boolean {
  if (!p) return false;
  const norm = p.replace(/\\/g, "/");
  if (norm.split("/").includes("..")) return false;
  return norm === WIKI_DIR || norm.startsWith(`${WIKI_DIR}/`);
}

function headingText(goal: string): string {
  const flat = goal.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildRunEntry(f: WikiRunFacts): string {
  const lines = [
    `<!-- run:${f.runId} -->`,
    `## ${isoDay(f.completedAt)} — ${headingText(f.goal)}`,
    "",
    `- Run \`${f.runId.slice(0, 8)}\` · ${f.stepCount} step(s) · verification ${f.verificationPassed}/${f.verificationTotal} passed`,
  ];
  if (f.affectedFiles.length > 0) {
    const shown = f.affectedFiles.slice(0, 5).map((x) => `\`${x}\``);
    const more = f.affectedFiles.length > 5 ? ` (+${f.affectedFiles.length - 5} more)` : "";
    lines.push(`- Touched: ${shown.join(", ")}${more}`);
  }
  lines.push("");
  return lines.join("\n");
}

function splitEntries(doc: string): { header: string; entries: string[] } {
  const positions = [...doc.matchAll(RUN_MARKER_RE)].map((m) => m.index ?? 0);
  if (positions.length === 0) return { header: doc, entries: [] };
  const header = doc.slice(0, positions[0]!);
  const entries = positions.map((p, i) => doc.slice(p, positions[i + 1] ?? doc.length).trimEnd());
  return { header, entries };
}

/**
 * Merge a run entry into the changelog: newest-first, idempotent per run
 * (marker match), capped at MAX_CHANGELOG_ENTRIES. Returns the existing doc
 * unchanged when the run is already recorded (caller skips the write).
 */
export function mergeChangelog(existing: string | null, entry: string): string {
  const fresh = entry.trimEnd();
  if (existing === null) {
    return [
      "# Changelog",
      "",
      "Completed runs recorded automatically by AI Harness.",
      "",
      fresh,
      "",
    ].join("\n");
  }
  if (existing.includes(`<!-- run:${extractMarkerId(entry)} -->`)) return existing;
  const { header, entries } = splitEntries(existing);
  const merged = [fresh, ...entries].slice(0, MAX_CHANGELOG_ENTRIES);
  return `${header}${merged.join("\n\n")}\n`;
}

function extractMarkerId(entry: string): string {
  return /<!-- run:([^>]+) -->/.exec(entry)?.[1] ?? "";
}

export function buildIndex(input: {
  projectName: string;
  pages: string[];
  recentRuns: WikiRecentRun[];
  lastRunId: string;
  lastRunAt: Date;
}): string {
  const pages = input.pages.filter((p) => p.endsWith(".md")).sort((a, b) => a.localeCompare(b));
  const pageSection =
    pages.length > 0
      ? pages
          .map((p) => {
            const title = p.replace(/\.md$/, "").replace(/[-_]/g, " ");
            return `- [${title}](${WIKI_PAGES_DIR}/${p})`;
          })
          .join("\n")
      : '_No topic pages yet — ask the agent to create one (e.g. "write an architecture page to .aiharness/wiki/pages/architecture.md")._';
  const runRows =
    input.recentRuns.length > 0
      ? input.recentRuns
          .map((r) => `| ${isoDay(r.completedAt)} | ${r.goal.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim().slice(0, 120)} |`)
          .join("\n")
      : "| — | No completed runs yet |";
  return [
    `# ${input.projectName} wiki`,
    "",
    "Living documentation for this repository, generated and refreshed automatically by AI Harness runs.",
    `Topic pages are authored by the agent under \`${WIKI_PAGES_DIR}/\`; \`index.md\` and \`changelog.md\` are regenerated — put prose in topic pages, not here.`,
    "",
    "## Topic pages",
    "",
    pageSection,
    "",
    "## Recent runs",
    "",
    "| Date | Goal |",
    "| --- | --- |",
    runRows,
    "",
    "---",
    `_Generated by AI Harness · last maintained ${input.lastRunAt.toISOString()} (run \`${input.lastRunId.slice(0, 8)}\`)_`,
    "",
  ].join("\n");
}

export class WikiMaintainer {
  constructor(
    private readonly deps: WikiDeps,
    private readonly logger: Logger,
  ) {}

  /** Hook entry point — errors are logged, never rethrown (runs stay green). */
  async maintainFromHook(ctx: HookContext): Promise<void> {
    try {
      await this.maintain({
        projectId: ctx.projectId,
        taskId: ctx.taskId,
        runId: ctx.runId,
        payload: ctx.payload ?? {},
      });
    } catch (err) {
      this.logger.warn({ err, taskId: ctx.taskId, runId: ctx.runId }, "wiki maintenance failed");
    }
  }

  /** Returns the wiki paths written, or null when maintenance was skipped. */
  async maintain(input: {
    projectId: string;
    taskId: string;
    runId: string;
    payload: Record<string, unknown>;
  }): Promise<string[] | null> {
    const project = await this.deps.getProject(input.projectId);
    if (!project) return null;
    const w: WikiRoot = {
      root: project.rootReference,
      environment: project.environment,
      taskId: input.taskId,
      runId: input.runId,
    };

    let present: string[] = [];
    try {
      present = await this.deps.listWiki(w, WIKI_DIR);
    } catch {
      present = [];
    }
    if (present.length === 0) return null; // opt-in: wiki not initialized for this repo

    const facts = await this.deps.getRunFacts(input.taskId, input.runId, input.payload);
    if (!facts) return null;

    // Only read the changelog when the presence listing shows it — a first-run
    // read would otherwise log a harness-level "tool execution failed" for ENOENT.
    const changelogName = WIKI_CHANGELOG_PATH.split("/").pop() ?? "";
    const existing = present.includes(changelogName)
      ? await this.deps.readWiki(w, WIKI_CHANGELOG_PATH)
      : null;
    const merged = mergeChangelog(existing, buildRunEntry(facts));

    let pages: string[] = [];
    try {
      pages = await this.deps.listWiki(w, WIKI_PAGES_DIR);
    } catch {
      pages = [];
    }
    let recentRuns: WikiRecentRun[] = [];
    try {
      recentRuns = await this.deps.getRecentRuns(input.projectId);
    } catch (err) {
      // Enrichment only: a flaky DB read must not prevent the index from refreshing.
      this.logger.warn({ err, projectId: input.projectId }, "wiki recent-runs query failed");
    }

    const written: string[] = [];
    if (merged !== existing) {
      await this.writeWithRetry(w, WIKI_CHANGELOG_PATH, merged);
      written.push(WIKI_CHANGELOG_PATH);
    }
    const index = buildIndex({
      projectName: project.name,
      pages,
      recentRuns,
      lastRunId: input.runId,
      lastRunAt: facts.completedAt,
    });
    await this.writeWithRetry(w, WIKI_INDEX_PATH, index);
    written.push(WIKI_INDEX_PATH);
    return written;
  }

  /**
   * Maintenance writes run from a lifecycle hook on a loaded machine — a single
   * sandbox/bridge write can exceed the tool's 30s timeout while the executor
   * is still spinning up. One retry after a short pause keeps the hook
   * best-effort without ever failing the run.
   */
  private async writeWithRetry(w: WikiRoot, path: string, content: string): Promise<void> {
    try {
      await this.deps.writeWiki(w, path, content);
    } catch (first) {
      this.logger.warn({ err: first, path }, "wiki write failed; retrying once");
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await this.deps.writeWiki(w, path, content);
    }
  }
}

/** Normalize `filesystem.list` output across bridge ({entries}) and sandbox (ls -la text). */
export function extractListNames(output: Record<string, unknown>): string[] {
  const entries = output["entries"];
  if (Array.isArray(entries)) {
    return entries
      .map((e) => (e && typeof e === "object" ? (e as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === "string" && n.length > 0);
  }
  const raw = output["output"];
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("total "))
      .map((l) => {
        const parts = l.split(/\s+/);
        return parts.length >= 9 ? parts.slice(8).join(" ") : parts[parts.length - 1]!;
      })
      .filter((n) => n.length > 0 && n !== "." && n !== "..");
  }
  return [];
}

/** Normalize `filesystem.read` output across bridge ({content}) and sandbox (cat stdout). */
export function extractReadText(output: Record<string, unknown>): string | null {
  if (typeof output["content"] === "string") return output["content"];
  if (typeof output["output"] === "string") return output["output"];
  return null;
}

/** Production deps: Prisma for facts, ToolHarness for repo-file IO (bridge or sandbox). */
export function createPrismaWikiDeps(prisma: PrismaClient, harness: ToolHarness): WikiDeps {
  const exec = async (w: WikiRoot, toolName: string, input: Record<string, unknown>) =>
    harness.execute({
      toolCallId: `wiki-${w.runId}-${toolName}`,
      taskId: w.taskId,
      runId: w.runId,
      environment: w.environment,
      toolName,
      input,
    });

  return {
    async getProject(projectId) {
      const p = await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, rootReference: true, connectionType: true },
      });
      if (!p) return null;
      return {
        name: p.name,
        rootReference: p.rootReference,
        environment: p.connectionType === "CLOUD" ? "CLOUD_SANDBOX" : "LOCAL_BRIDGE",
      };
    },

    async getRunFacts(taskId, runId, payload) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { goal: true, completedAt: true },
      });
      if (!task) return null;
      const planId = typeof payload["planId"] === "string" ? payload["planId"] : null;
      const plan = planId
        ? await prisma.taskPlan.findUnique({
            where: { id: planId },
            select: { affectedFiles: true },
          })
        : null;
      const affectedFiles = Array.isArray(plan?.affectedFiles)
        ? (plan.affectedFiles as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const verificationTotal = await prisma.verificationResult.count({ where: { taskId, runId } });
      return {
        runId,
        goal: task.goal,
        completedAt: task.completedAt ?? new Date(),
        stepCount: typeof payload["stepCount"] === "number" ? payload["stepCount"] : 0,
        verificationPassed:
          typeof payload["verificationPassed"] === "number" ? payload["verificationPassed"] : 0,
        verificationTotal,
        affectedFiles,
      };
    },

    async getRecentRuns(projectId) {
      const rows = await prisma.task.findMany({
        where: { projectId, state: "COMPLETED", completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: 5,
        select: { goal: true, completedAt: true },
      });
      return rows.map((r) => ({ goal: r.goal, completedAt: r.completedAt! }));
    },

    async listWiki(w, path) {
      const res = await exec(w, "filesystem.list", { root: w.root, path });
      if (res.status !== "SUCCEEDED" || !res.output) return [];
      return extractListNames(res.output);
    },

    async readWiki(w, path) {
      const res = await exec(w, "filesystem.read", { root: w.root, path });
      if (res.status !== "SUCCEEDED" || !res.output) return null;
      return extractReadText(res.output);
    },

    async writeWiki(w, path, content) {
      const res = await exec(w, "filesystem.write", { root: w.root, path, content });
      if (res.status !== "SUCCEEDED") {
        throw new Error(`wiki write failed for ${path}: ${res.failureMessage ?? res.status}`);
      }
    },
  };
}
