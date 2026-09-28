/**
 * AI Harness — Local Bridge reference agent.
 *
 * Connects to the Bridge Gateway over WebSocket and executes confined tool
 * requests against explicitly registered project roots. Path boundaries are
 * enforced HERE (on the machine that owns the filesystem) — never in the
 * browser. The production bridge is specified as Go (TECH_STACK.md); this
 * TypeScript reference implementation is protocol-compatible and ships now so
 * local execution works end-to-end (DECISIONS.md D15).
 *
 * Usage:
 *   npx tsx src/agent.ts pair --token <pairing-token> [--name MyBridge]
 *   npx tsx src/agent.ts add-root <absolute-path> [label]
 *   npx tsx src/agent.ts roots
 *   npx tsx src/agent.ts run
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { WebSocket } from "ws";
import { createHash } from "node:crypto";
import { confinePath, isSafeOutboundUrl, sha256Hex, type CheckpointStateReference } from "@ai-harness/shared";

const API_URL = process.env.AI_HARNESS_API_URL ?? "http://localhost:4000";
const GATEWAY_URL = process.env.AI_HARNESS_GATEWAY_URL ?? "ws://localhost:4010/bridge";
const CONFIG_DIR = join(homedir(), ".ai-harness-bridge");
const CONFIG_FILE = process.env["AI_HARNESS_BRIDGE_CONFIG"] ?? join(CONFIG_DIR, "config.json");

interface BridgeConfig {
  apiUrl: string;
  gatewayUrl: string;
  bridgeId?: string;
  deviceToken?: string;
  name?: string;
  roots: Array<{ label: string; path: string }>;
}

function loadConfig(): BridgeConfig {
  if (!existsSync(CONFIG_FILE)) return { apiUrl: API_URL, gatewayUrl: GATEWAY_URL, roots: [] };
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as BridgeConfig;
}
function saveConfig(cfg: BridgeConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}
function log(msg: string): void {
  console.log(`[bridge] ${msg}`);
}

// ── Commands ─────────────────────────────────────────────────────────

async function cmdPair(token: string, name?: string): Promise<void> {
  const res = await fetch(`${API_URL}/v1/bridges/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingToken: token,
      name: name ?? `Local Bridge (${hostname()})`,
      version: "0.2.0",
      capabilities: { filesystem: true, git: true, terminal: true, checkpoints: true },
    }),
  });
  const body = (await res.json()) as { data?: { bridgeId: string; deviceToken: string }; error?: unknown };
  if (res.status !== 201 || !body.data) {
    throw new Error(`pairing failed: ${JSON.stringify(body).slice(0, 300)}`);
  }
  const cfg = loadConfig();
  cfg.bridgeId = body.data.bridgeId;
  cfg.deviceToken = body.data.deviceToken;
  cfg.name = name;
  saveConfig(cfg);
  log(`paired successfully — bridge ${body.data.bridgeId}`);
  log("next: register a project root with `add-root <path>` then `run`.");
}

async function cmdAddRoot(pathArg: string, label?: string): Promise<void> {
  const abs = resolve(pathArg);
  if (!isAbsolute(abs) || !existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`root must be an existing absolute directory: ${abs}`);
  }
  const cfg = loadConfig();
  if (!cfg.bridgeId) throw new Error("pair first");
  if (!cfg.roots.some((r) => r.path.toLowerCase() === abs.toLowerCase())) {
    cfg.roots.push({ label: label ?? abs.split(/[\\/]/).pop() ?? abs, path: abs });
    saveConfig(cfg);
  }
  await fetch(`${API_URL}/v1/bridges/${cfg.bridgeId}/project-roots`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.deviceToken}` },
    body: JSON.stringify({ displayName: label ?? abs.split(/[\\/]/).pop(), canonicalRootReference: abs }),
  }).then(async (res) => {
    if (res.status === 401 || res.status === 403) {
      // Device tokens are gateway-credentials; root registration uses the owner account today.
      log("note: register the same root via the web UI if the API rejected the device call.");
    }
  });
  log(`registered root ${abs}`);
}

// ── Tool execution ───────────────────────────────────────────────────

// Background process registry for preview/dev-server management
interface BackgroundProcess {
  pid: number;
  child: ChildProcess;
  command: string;
  cwd: string;
  logs: string[];
  startedAt: number;
  exitCode: number | null;
  exited: boolean;
}
const backgroundProcesses = new Map<string, BackgroundProcess>();
let processCounter = 0;

function cleanupBackgroundProcesses(): void {
  for (const [id, proc] of backgroundProcesses) {
    if (!proc.exited) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
        } else {
          proc.child.kill("SIGTERM");
        }
      } catch { /* gone */ }
    }
  }
}

function git(root: string, args: string[], timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const child = spawn("git", ["--no-optional-locks", "-C", root, ...args], {
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    const cap = 512_000;
    child.stdout.on("data", (d: Buffer) => { if (stdout.length < cap) stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { if (stderr.length < cap) stderr += d.toString("utf8"); });
    const timer = setTimeout(() => {
      child.kill();
      resolveP({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ code: code ?? 1, stdout, stderr });
    });
  });
}

const READONLY_ALLOW = [
  "git log", "git status", "git diff", "git show", "git branch",
  "ls", "dir", "cat", "type", "node -v", "node --version", "npm -v", "npm test", "npm run",
  "pnpm -v", "yarn -v", "python --version",
];
const READONLY_DENY = [/rm\s/, /del\s/i, /rmdir/i, /format/i, /shutdown/i, /mkfs/i, /diskpart/i, /curl/i, /wget/i, /invoke-/i];

function execCommand(root: string, command: string, readonly: boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  const cmd = command.trim();
  if (readonly && !READONLY_ALLOW.some((p) => cmd.startsWith(p))) {
    throw Object.assign(new Error(`command not on the read-only allowlist`), { code: "POLICY_DENIED" });
  }
  if (READONLY_DENY.some((re) => re.test(cmd))) {
    throw Object.assign(new Error("command matches deny pattern"), { code: "POLICY_DENIED" });
  }
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, [], {
      cwd: root,
      shell: true,
      windowsHide: true,
      env: { PATH: process.env["PATH"], HOME: process.env["HOME"] ?? process.env["USERPROFILE"], LANG: "C" },
    });
    let stdout = "";
    let stderr = "";
    const cap = 256_000;
    child.stdout.on("data", (d: Buffer) => { if (stdout.length < cap) stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { if (stderr.length < cap) stderr += d.toString("utf8"); });
    const timer = setTimeout(() => {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
        } else {
          child.kill("SIGKILL");
        }
      } catch { /* already gone */ }
      rejectP(Object.assign(new Error("command timed out"), { code: "TOOL_TIMEOUT" }));
    }, Math.min(timeoutMs, 120_000));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ exitCode: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => rejectP(err));
  });
}

async function handle(kind: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const needsRoot = kind !== "ckpt.rollback" && kind !== "mcp.stdio";
  const root = typeof params["root"] === "string" ? params["root"] : "";
  if (needsRoot && !root) throw Object.assign(new Error("missing root"), { code: "VALIDATION_ERROR" });

  const registered = loadConfig().roots.map((r) => resolve(r.path));

  // Per-task execution isolation — confine root via confinePath and audit log taskId→root
  function enforcePerTaskConfinement(taskParams: Record<string, unknown>, requestedRoot: string, registeredRoots: string[], toolKind: string): void {
    const taskId =
      typeof taskParams["taskId"] === "string"
        ? (taskParams["taskId"] as string)
        : typeof taskParams["_taskId"] === "string"
          ? (taskParams["_taskId"] as string)
          : undefined;
    const isFilesystemOrTerminal =
      toolKind.startsWith("fs.") ||
      toolKind === "term.ro" ||
      toolKind === "term.run" ||
      toolKind === "terminal.run" ||
      toolKind === "terminal.ro" ||
      toolKind.startsWith("filesystem.") ||
      toolKind.startsWith("terminal.");
    if (taskId) {
      log(`audit: task ${taskId} → root ${requestedRoot} [${toolKind}]`);
    } else if (isFilesystemOrTerminal) {
      // Validate taskId is provided where applicable and log anonymous access for audit
      log(`audit: anonymous → root ${requestedRoot} [${toolKind}] (no taskId)`);
    }
    // Validate root via confinePath (not naive startsWith) — ensures normalized/ traversal-safe containment
    const allowed = registeredRoots.some((reg) => {
      const res = confinePath(reg, requestedRoot);
      if (res.allowed) return true;
      // Fallback case-insensitive exact match for Windows paths
      return resolve(reg).toLowerCase() === resolve(requestedRoot).toLowerCase();
    });
    if (!allowed) {
      throw Object.assign(new Error("root is not registered on this bridge"), { code: "POLICY_DENIED" });
    }
  }

  if (needsRoot) {
    enforcePerTaskConfinement(params, root, registered, kind);
  }

  const confined = (p: unknown): string => {
    const result = confinePath(root, String(p ?? "."));
    if (!result.allowed || !result.resolved) {
      throw Object.assign(new Error(result.reason ?? "path rejected"), { code: "POLICY_DENIED" });
    }
    return result.resolved;
  };

  // Protocol alias: API routes may send "terminal.run" but bridge handles "term.run"
  const normalizedKind = kind === "terminal.run" ? "term.run" : kind === "terminal.ro" ? "term.ro" : kind;

  switch (normalizedKind) {
    case "fs.list": {
      const dir = confined(params["path"] ?? ".");
      const entries = readdirSync(dir, { withFileTypes: true }).slice(0, 500);
      return {
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : e.isSymbolicLink() ? "symlink" : "file",
        })),
      };
    }
    case "fs.read": {
      const file = confined(params["path"]);
      const st = statSync(file);
      if (st.size > 2_000_000) throw Object.assign(new Error("file too large"), { code: "OUTPUT_LIMIT" });
      return { content: readFileSync(file, "utf8"), sizeBytes: st.size };
    }
    case "fs.search": {
      const base = confined(".");
      const rawQuery = String(params["query"] ?? "");
      if (!rawQuery) throw Object.assign(new Error("query required"), { code: "VALIDATION_ERROR" });
      const caseSensitive = params["caseSensitive"] === true;
      const query = caseSensitive ? rawQuery : rawQuery.toLowerCase();
      const hits: Array<{ file: string; line: number; text: string }> = [];
      const walk = (dir: string, depth: number): void => {
        if (hits.length >= 50 || depth > 8) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (hits.length >= 50) return;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.isSymbolicLink()) continue;
            if (!["node_modules", ".git", "dist", ".next"].includes(entry.name)) walk(full, depth + 1);
            continue;
          }
          try {
            const content = readFileSync(full, "utf8").split("\n");
            for (let i = 0; i < content.length && hits.length < 50; i++) {
              const lineText = caseSensitive ? content[i]! : content[i]!.toLowerCase();
              if (lineText.includes(query)) hits.push({ file: full.slice(base.length + 1), line: i + 1, text: content[i]!.trim().slice(0, 200) });
            }
          } catch { /* binary or unreadable */ }
        }
      };
      walk(base, 0);
      return { matches: hits };
    }
    case "fs.write":
    case "fs.create": {
      const file = confined(params["path"]);
      // Drift detection (APP_FLOW §14): reject overwrite when caller pinned an
      // expected content hash and the file changed underneath.
      if (normalizedKind === "fs.write" && existsSync(file) && typeof params["expectedSha256"] === "string") {
        const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
        if (actual !== params["expectedSha256"]) {
          throw Object.assign(new Error("file changed since read (drift detected)"), { code: "DRIFT_DETECTED" });
        }
      }
      if (normalizedKind === "fs.create" && existsSync(file)) {
        throw Object.assign(new Error("file already exists"), { code: "CONFLICT" });
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, String(params["content"] ?? ""), "utf8");
      return { written: file.slice(resolve(root).length + 1), bytes: Buffer.byteLength(String(params["content"] ?? "")) };
    }
    case "fs.rename": {
      const from = confined(params["from"]);
      const to = confined(params["to"]);
      renameSync(from, to);
      return { renamed: true };
    }
    case "fs.delete": {
      const file = confined(params["path"]);
      const st = statSync(file);
      if (st.isDirectory()) throw Object.assign(new Error("refusing to delete a directory"), { code: "POLICY_DENIED" });
      rmSync(file);
      return { deleted: true };
    }
    case "git.status": {
      const [branch, status] = await Promise.all([
        git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
        git(root, ["status", "--porcelain=v1"]),
      ]);
      return { branch: branch.stdout.trim(), clean: status.stdout.trim().length === 0, raw: status.stdout.slice(0, 20_000) };
    }
    case "git.diff": {
      const staged = params["staged"] === true;
      const diff = await git(root, ["diff", ...(staged ? ["--staged"] : []), "--no-color"]);
      return { diff: (diff.stdout + diff.stderr).slice(0, 400_000) };
    }
    case "git.log": {
      const count = Math.min(Number(params["count"] ?? 20), 100);
      const log = await git(root, ["log", `--max-count=${count}`, "--pretty=format:%H|%an|%ae|%ai|%s"]);
      const entries = log.stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [hash, author, email, date, ...msgParts] = line.split("|");
        return { hash, author, email, date, message: msgParts.join("|") };
      });
      return { entries };
    }
    case "git.blame": {
      const filePath = confined(params["path"]);
      const blame = await git(root, ["blame", "--line-porcelain", filePath]);
      const lines = blame.stdout.split("\n");
      const entries: Array<{ hash: string; author: string; line: number; content: string }> = [];
      let current: Partial<{ hash: string; author: string; line: number; content: string }> = {};
      let lineNum = 1;
      for (const line of lines) {
        if (line.startsWith("author ")) {
          current.author = line.slice(7);
        } else if (line.startsWith("filename ")) {
          // skip
        } else if (line.startsWith("\t")) {
          current.content = line.slice(1);
          current.line = lineNum++;
          entries.push(current as { hash: string; author: string; line: number; content: string });
          current = {};
        } else if (line.match(/^[0-9a-f]{40}/)) {
          current.hash = line.slice(0, 40);
        }
      }
      return { entries: entries.slice(0, 500) };
    }
    case "git.branch": {
      const branchName = String(params["name"] ?? "");
      if (branchName) {
        await git(root, ["checkout", "-b", branchName]);
        return { created: branchName };
      }
      const branches = await git(root, ["branch", "--no-color"]);
      const list = branches.stdout.split("\n").map((b) => b.replace(/^\*?\s+/, "").trim()).filter(Boolean);
      return { branches: list, current: list.find((b) => b.startsWith("*"))?.slice(1) ?? list[0] };
    }
    case "git.commit": {
      const message = String(params["message"] ?? "");
      const all = params["all"] === true;
      const files = params["files"] as string[] | undefined;
      if (files && files.length > 0) {
        for (const f of files) {
          await git(root, ["add", f]);
        }
      } else if (all) {
        await git(root, ["add", "-A"]);
      }
      const result = await git(root, ["commit", "-m", message]);
      const hash = result.stdout.match(/\[[\w]+\s+([0-9a-f]+)\]/)?.[1] ?? "";
      return { hash, message, output: result.stdout.slice(0, 10_000) };
    }
    case "git.merge": {
      const branch = String(params["branch"] ?? "");
      if (!branch) throw Object.assign(new Error("missing branch"), { code: "VALIDATION_ERROR" });
      const result = await git(root, ["merge", branch, "--no-edit"]);
      return { merged: true, branch, output: result.stdout.slice(0, 10_000) };
    }
    case "git.stash": {
      const action = String(params["action"] ?? "push");
      const message = params["message"] as string | undefined;
      let args: string[];
      switch (action) {
        case "push":
          args = ["stash", "push", ...(message ? ["-m", message] : [])];
          break;
        case "pop":
          args = ["stash", "pop"];
          break;
        case "apply":
          args = ["stash", "apply"];
          break;
        case "drop":
          args = ["stash", "drop"];
          break;
        case "list":
          args = ["stash", "list"];
          break;
        default:
          args = ["stash", "push"];
      }
      const result = await git(root, args);
      return { action, output: result.stdout.slice(0, 20_000) };
    }
    case "term.ro":
      return execCommand(root, String(params["command"]), true, 60_000);
    case "term.run":
      return execCommand(root, String(params["command"]), false, 120_000);
    case "process.start": {
      // Background process for preview/dev-server
      const command = String(params["command"] ?? "");
      if (!command) throw Object.assign(new Error("missing command"), { code: "VALIDATION_ERROR" });
      const cwd = root;
      const procId = `proc-${++processCounter}`;

      const child = spawn(command, [], {
        cwd,
        shell: true,
        windowsHide: false,
        env: { ...process.env, PATH: process.env["PATH"], HOME: process.env["HOME"] ?? process.env["USERPROFILE"] },
      });

      const bgProc: BackgroundProcess = {
        pid: child.pid ?? 0,
        child,
        command,
        cwd,
        logs: [],
        startedAt: Date.now(),
        exitCode: null,
        exited: false,
      };

      child.stdout?.on("data", (d: Buffer) => {
        const line = d.toString("utf8");
        bgProc.logs.push(line);
        if (bgProc.logs.length > 500) bgProc.logs.shift();
      });
      child.stderr?.on("data", (d: Buffer) => {
        const line = d.toString("utf8");
        bgProc.logs.push(line);
        if (bgProc.logs.length > 500) bgProc.logs.shift();
      });
      child.on("close", (code) => {
        bgProc.exitCode = code ?? 1;
        bgProc.exited = true;
        log(`background process ${procId} exited with code ${code}`);
      });
      child.on("error", () => {
        bgProc.exitCode = 1;
        bgProc.exited = true;
      });

      backgroundProcesses.set(procId, bgProc);
      log(`started background process ${procId}: ${command} (pid ${child.pid})`);
      return { processId: procId, pid: child.pid, status: "running" };
    }
    case "process.stop": {
      const processId = String(params["processId"] ?? "");
      const proc = backgroundProcesses.get(processId);
      if (!proc) throw Object.assign(new Error(`process ${processId} not found`), { code: "NOT_FOUND" });
      if (!proc.exited) {
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
          } else {
            proc.child.kill("SIGTERM");
            setTimeout(() => { if (!proc.exited) proc.child.kill("SIGKILL"); }, 5000);
          }
        } catch { /* gone */ }
      }
      backgroundProcesses.delete(processId);
      return { stopped: true, exitCode: proc.exitCode };
    }
    case "process.status": {
      const processId = String(params["processId"] ?? "");
      const proc = backgroundProcesses.get(processId);
      if (!proc) throw Object.assign(new Error(`process ${processId} not found`), { code: "NOT_FOUND" });
      return {
        processId,
        pid: proc.pid,
        command: proc.command,
        status: proc.exited ? "exited" : "running",
        exitCode: proc.exitCode,
        startedAt: proc.startedAt,
        uptimeMs: Date.now() - proc.startedAt,
        logCount: proc.logs.length,
      };
    }
    case "process.logs": {
      const processId = String(params["processId"] ?? "");
      const proc = backgroundProcesses.get(processId);
      if (!proc) throw Object.assign(new Error(`process ${processId} not found`), { code: "NOT_FOUND" });
      const tail = typeof params["tail"] === "number" ? params["tail"] : 200;
      const offset = typeof params["offset"] === "number" ? params["offset"] : Math.max(0, proc.logs.length - tail);
      return {
        logs: proc.logs.slice(offset).join(""),
        totalLines: proc.logs.length,
        offset,
        exited: proc.exited,
        exitCode: proc.exitCode,
      };
    }
    case "ckpt.create": {
      const head = await git(root, ["rev-parse", "HEAD"]);
      if (head.code !== 0) throw Object.assign(new Error("not a git repository"), { code: "NOT_A_REPO" });
      const headSha = head.stdout.trim();
      // git stash create does NOT support --include-untracked in git < 2.35 and
      // semantically creates a dangling commit without touching refs. To include
      // untracked files we stage them first with `git add -A`, create the stash
      // commit, then reset the index — leaving working tree and index exactly as
      // before. This is portable across all git versions.
      await git(root, ["add", "-A"]);
      const stash = await git(root, ["stash", "create"]);
      // always reset even if create failed
      await git(root, ["reset"]).catch(() => undefined);
      const stashSha = stash.stdout.trim();
      const ref = stashSha.length >= 40 ? stashSha : headSha;
      const stateReference: CheckpointStateReference = {
        kind: "git", root: resolve(root), headBefore: headSha, ref, createdStash: stashSha.length >= 40,
      };
      return stateReference as unknown as Record<string, unknown>;
    }
    case "ckpt.diff": {
      const ref = String(params["ref"] ?? "");
      if (!/^[0-9a-f]{40}$/i.test(ref)) throw Object.assign(new Error("ref required"), { code: "VALIDATION_ERROR" });
      const d = await git(root, ["diff", ref, "--no-color", "--", "."]);
      return { diff: (d.stdout + d.stderr).slice(0, 400_000) };
    }
    case "http.proxy": {
      const url = String(params["url"] ?? "");
      if (!url) throw Object.assign(new Error("missing url"), { code: "VALIDATION_ERROR" });
      // SSRF allowlist enforcement — block private/internal destinations
      const ssrfGuard = isSafeOutboundUrl(url);
      if (!ssrfGuard.allowed) {
        throw Object.assign(new Error(ssrfGuard.reason ?? "requests to private/internal addresses are denied by policy"), { code: "POLICY_DENIED" });
      }
      const method = String(params["method"] ?? "GET");
      const headers = (params["headers"] as Record<string, string> | undefined) ?? {};
      const reqBody = params["body"] as string | undefined;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw Object.assign(new Error("invalid url"), { code: "VALIDATION_ERROR" });
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw Object.assign(new Error("only http/https allowed"), { code: "VALIDATION_ERROR" });
      }
      // Fetch through the bridge host — allows remote preview when browser is not on bridge machine.
      const fetchOpts: RequestInit = { method, headers };
      if (reqBody && method !== "GET" && method !== "HEAD") fetchOpts.body = reqBody;
      const resp = await fetch(url, fetchOpts);
      const text = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });
      return {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
        body: text.slice(0, 1_000_000),
        ok: resp.ok,
      };
    }
    case "ckpt.rollback": {
      // Rollback may target any configured root passed by the harness.
      const rollbackRoot = root || registered[0];
      if (!rollbackRoot) throw Object.assign(new Error("no registered root for rollback"), { code: "VALIDATION_ERROR" });
      const ref = String(params["ref"] ?? "");
      if (!/^[0-9a-f]{40}$/i.test(ref)) throw Object.assign(new Error("ref must be a commit sha"), { code: "VALIDATION_ERROR" });
      // Backup current dirty state (including untracked) before hard reset so it can be recovered
      try {
        await git(rollbackRoot, ["stash", "push", "-m", `pre-rollback-backup-${Date.now()}`, "--include-untracked", "--keep-index"]);
      } catch {
        // Best-effort backup — do not fail rollback if stash fails
      }
      const done = await git(rollbackRoot, ["reset", "--hard", ref]);
      if (done.code !== 0) throw Object.assign(new Error(done.stderr || "rollback failed"), { code: "ROLLBACK_FAILED" });
      return { resetTo: ref, output: done.stdout.slice(0, 2000) };
    }
    case "mcp.stdio": {
      // One-shot JSON-RPC exchange with a short-lived STDIO MCP server process.
      const command = String(params["command"] ?? "");
      if (!command) throw Object.assign(new Error("missing command"), { code: "VALIDATION_ERROR" });
      const rpc = params["rpc"] as Record<string, unknown> | undefined;
      if (!rpc) throw Object.assign(new Error("missing rpc payload"), { code: "VALIDATION_ERROR" });
      const args = Array.isArray(params["args"]) ? (params["args"] as string[]) : [];

      return await new Promise<Record<string, unknown>>((resolveP, rejectP) => {
        const child = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: { PATH: process.env["PATH"], HOME: process.env["HOME"] ?? process.env["USERPROFILE"] },
        });
        let out = "";
        let settled = false;
        const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* gone */ }
          finish(() => rejectP(Object.assign(new Error("stdio mcp timed out"), { code: "TOOL_TIMEOUT" })));
        }, 20_000);
        child.stdout.on("data", (d: Buffer) => {
          out += d.toString("utf8");
          const nl = out.indexOf("\n");
          if (nl >= 0) {
            try {
              const parsed = JSON.parse(out.slice(0, nl)) as { id?: number; result?: unknown; error?: unknown };
              if (parsed.id === 1) {
                finish(() => resolveP({ content: (parsed.result ?? null) as unknown }));
                child.kill();
              }
            } catch { /* partial line — keep buffering */ }
          }
        });
        child.stderr.on("data", () => undefined); // many MCP servers log on stderr
        child.on("error", (e) => finish(() => rejectP(Object.assign(e as Error, { code: "EXECUTION_FAILED" }))));
        child.on("close", () => finish(() => rejectP(Object.assign(new Error("server exited before reply"), { code: "EXECUTION_FAILED" }))));
        child.stdin.write(JSON.stringify(rpc) + "\n");
        child.stdin.end();
      });
    }
    default:
      throw Object.assign(new Error(`unsupported kind ${kind}`), { code: "UNSUPPORTED" });
  }
}

// ── Runtime ──────────────────────────────────────────────────────────

function runAgent(): void {
  const cfg = loadConfig();
  if (!cfg.bridgeId || !cfg.deviceToken) {
    throw new Error("This bridge is not paired yet. Run `pair --token <token>` first.");
  }
  let closedByUser = false;

  const connect = (): void => {
    log(`connecting to gateway ${cfg.gatewayUrl} …`);
    const ws = new WebSocket(cfg.gatewayUrl);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", bridgeId: cfg.bridgeId, deviceToken: cfg.deviceToken, version: "0.2.0" }));
    });
    ws.on("message", async (raw: Buffer) => {
      let msg: { type?: string; id?: string; kind?: string; params?: Record<string, unknown>; timeoutMs?: number };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "welcome") { log("authenticated with gateway ✓"); return; }
      if (msg.type === "exec" && msg.id) {
        let payload: { id: string; ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
        try {
          const data = await handle(String(msg.kind), msg.params ?? {});
          payload = { id: msg.id, ok: true, data };
        } catch (err) {
          payload = {
            id: msg.id,
            ok: false,
            error: {
              code: (err as { code?: string }).code ?? "EXECUTION_FAILED",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
        ws.send(JSON.stringify({ type: "result", ...payload }));
      }
    });
    ws.on("close", () => {
      if (closedByUser) return;
      let attempts = 0;
      const maxDelay = 60_000;
      const reconnect = () => {
        if (closedByUser) return;
        attempts++;
        const delay = Math.min(3000 * Math.pow(1.5, attempts - 1), maxDelay);
        log(`connection lost — retrying in ${Math.round(delay / 1000)}s (attempt ${attempts})`);
        setTimeout(connect, delay);
      };
      reconnect();
    });
    ws.on("error", () => ws.close());
  };

  process.on("SIGINT", () => { closedByUser = true; cleanupBackgroundProcesses(); process.exit(0); });
  process.on("SIGTERM", () => { closedByUser = true; cleanupBackgroundProcesses(); process.exit(0); });
  process.on("exit", () => { cleanupBackgroundProcesses(); });
  connect();
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case "pair": {
      const tokenIdx = rest.indexOf("--token");
      const nameIdx = rest.indexOf("--name");
      const token = tokenIdx !== -1 ? rest[tokenIdx + 1] : rest[0];
      const name = nameIdx !== -1 ? rest[nameIdx + 1] : undefined;
      if (!token) throw new Error("usage: pair --token <token> [--name <name>]");
      await cmdPair(token, name);
      break;
    }
    case "add-root":
      if (!rest[0]) throw new Error("usage: add-root <path> [label]");
      await cmdAddRoot(resolve(rest[0]), rest[1]);
      break;
    case "roots": {
      const cfg = loadConfig();
      for (const r of cfg.roots) log(`${r.path} (${r.label})`);
      if (cfg.roots.length === 0) log("(no roots)");
      break;
    }
    case "run":
      runAgent();
      break;
    default:
      console.log("commands: pair --token T | add-root PATH [LABEL] | roots | run");
  }
}

main().catch((err) => {
  console.error("[bridge] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
