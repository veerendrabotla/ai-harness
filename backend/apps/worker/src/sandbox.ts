import type { PrismaClient } from "@prisma/client";
import { execFile, execSync, spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
  BridgeGatewayClient,
  createLogger,
  decryptSecret,
  errors,
  getEnv,
} from "@ai-harness/shared";
import { DeploymentEngine } from "@ai-harness/deployment-engine";
import type { MCPRegistry } from "@ai-harness/mcp-platform";
import { buildEnvironmentResolver as buildBaseResolver } from "./resolvers.js";
import type { ExecutionEnvironmentResolver } from "@ai-harness/tool-harness";
import { cloneUrlFor, containerPathFor, hostPathFor, workspaceKey } from "./workspace-paths.js";

const execFileAsync = promisify(execFile);

/**
 * Composite resolver:
 * - LOCAL_BRIDGE / INTERNAL → base gateway+MCP/HTTP resolvers
 * - CLOUD_SANDBOX → ephemeral Docker container per call when SANDBOX_MODE=docker
 *   (project root mounted read-write at /workspace; network disabled by default
 *   except for http.request which runs on the host instead).
 *   Non-absolute roots (e.g. github.com/owner/repo) are materialized into the
 *   shared workspace dir; container/host path mapping is handled by
 *   workspace-paths.ts because the worker container and the host Docker daemon
 *   mount the shared dir at different absolute paths.
 */
export function buildCompositeResolver(
  prisma: PrismaClient,
  mcpRegistry?: MCPRegistry,
  onDeploymentStatus?: (data: { deploymentId: string; status: string; failureReason?: string }) => void,
): ExecutionEnvironmentResolver {
  const base = buildBaseResolver(prisma, mcpRegistry);
  const env = getEnv();
  const sandboxEnabled = env["SANDBOX_MODE"] === "docker";
  const wsContainerDir = env["SANDBOX_WORKSPACE_DIR"] || path.join(os.tmpdir(), "ai-harness-workspaces");
  const wsHostDir = env["SANDBOX_WORKSPACE_HOST_DIR"] || wsContainerDir;
  const materialized = new Map<string, Promise<string>>();

  /**
   * Resolve a caller-supplied root into a worker-visible absolute path:
   * host paths under the shared workspace dir are translated into the
   * container view; non-absolute roots (github.com/owner/repo) are
   * materialized once into a stable per-ref workspace directory.
   */
  const materializeRoot = (rawRoot: string): Promise<string> => {
    const mapped = containerPathFor(rawRoot, wsContainerDir, wsHostDir);
    if (path.isAbsolute(mapped)) return Promise.resolve(mapped);
    const key = workspaceKey(rawRoot);
    let pending = materialized.get(key);
    if (!pending) {
      pending = materializeCloudRoot(rawRoot, path.join(wsContainerDir, key));
      materialized.set(key, pending);
    }
    return pending;
  };

  async function materializeCloudRoot(rootReference: string, dir: string): Promise<string> {
    await fs.mkdir(dir, { recursive: true });
    if ((await fs.readdir(dir)).length > 0) return dir;
    const url = cloneUrlFor(rootReference);
    if (url) {
      try {
        await execFileAsync("git", ["clone", "--depth", "1", url, dir], { timeout: 60_000 });
        return dir;
      } catch (err) {
        sandboxLog.warn({ err, rootReference }, "Cloud root clone failed; falling back to empty workspace");
      }
    }
    try {
      await execFileAsync("git", ["init"], { cwd: dir, timeout: 15_000 });
    } catch (err) {
      sandboxLog.warn({ err, rootReference }, "git init failed for materialized root");
    }
    return dir;
  }

  const dockerRun = (root: string, argv: string[], timeoutMs: number, extraArgs: string[] = []): Promise<Record<string, unknown>> =>
    new Promise((resolveP, rejectP) => {
      const image = env["SANDBOX_IMAGE"] || "node:22-alpine";
      const args = [
        "run", "--rm",
        "-v", `${hostPathFor(root, wsContainerDir, wsHostDir)}:/workspace`,
        "-e", "npm_config_update_notifier=false",
        // bind-mounted repos may carry foreign ownership; skip git's safe check
        "-e", "GIT_CONFIG_COUNT=1",
        "-e", "GIT_CONFIG_KEY_0=safe.directory",
        "-e", "GIT_CONFIG_VALUE_0=/workspace",
        ...extraArgs,
        "-w", "/workspace",
        "--network", "none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--cpus", "1", "--memory", "512m",
        "--tmpfs", "/tmp:size=50m",
        "--pids-limit", "64",
        image,
        ...argv,
      ];
      const child = spawn("docker", args, { windowsHide: true });
      let out = "";
      let err = "";
      const cap = 256_000;
      child.stdout.on("data", (d: Buffer) => { if (out.length < cap) out += d.toString("utf8"); });
      child.stderr.on("data", (d: Buffer) => { if (err.length < cap) err += d.toString("utf8"); });
      const timer = setTimeout(() => { child.kill(); rejectP(Object.assign(new Error("sandbox timed out"), { code: "TOOL_TIMEOUT" })); }, Math.min(timeoutMs, 120_000));
      child.on("error", (e) => { clearTimeout(timer); rejectP(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolveP({ output: out.slice(0, cap), exitCode: 0 });
        else rejectP(Object.assign(new Error(err.slice(0, 500) || `exit ${code}`), { code: "SANDBOX_FAILED" }));
      });
    });

  return {
    async resolve(environment, definition) {
      if (environment === "CLOUD_SANDBOX" && sandboxEnabled && definition.name !== "http.request") {
        // Sandbox tools operate relative to the mounted root; the caller passes root.
        return async (input: unknown) => {
          const params = { ...((input ?? {}) as Record<string, unknown>) };
          const rawRoot = typeof params["root"] === "string" ? params["root"] : "";
          if (!rawRoot) throw errors.validation("sandbox tools require a valid registered root path");
          const root = await materializeRoot(rawRoot);
          if (!getSafeRoot(root)) throw errors.validation("sandbox tools require a valid registered root path");
          params["root"] = root;

          switch (definition.name) {
            case "filesystem.list": {
              const sub = typeof params["path"] === "string" ? params["path"] : ".";
              return dockerRun(root, ["sh", "-c", `ls -la /workspace/${sanitizeRel(sub)}`], definition.timeoutMs);
            }
            case "filesystem.read": {
              const rel = sanitizeRel(String(params["path"] ?? ""));
              return dockerRun(root, ["sh", "-c", `cat /workspace/${rel}`], definition.timeoutMs);
            }
            case "filesystem.write":
            case "filesystem.create": {
              const rel = sanitizeRel(String(params["path"] ?? ""));
              const content = String(params["content"] ?? "");
              // Temp file must live under the mounted root: the docker daemon
              // cannot resolve arbitrary worker-container paths on the host.
              const tmpDir = path.join(root, ".aiharness-tmp");
              await fs.mkdir(tmpDir, { recursive: true });
              const name = `write-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              const tmpFile = path.join(tmpDir, name);
              await fs.writeFile(tmpFile, content, "utf8");
              try {
                // mkdir the parent first: `cp` cannot create nested paths, so
                // first writes into a fresh directory (e.g. .aiharness/wiki/)
                // would otherwise fail on CLOUD projects.
                return await dockerRun(
                  root,
                  ["sh", "-c", `mkdir -p "$(dirname "/workspace/${rel}")" && cp "/workspace/.aiharness-tmp/${name}" "/workspace/${rel}"`],
                  definition.timeoutMs,
                );
              } finally {
                await fs.unlink(tmpFile).catch((err) => {
                  sandboxLog.warn({ err }, "Failed to clean temp file");
                });
                await fs.rmdir(tmpDir).catch(() => undefined);
              }
            }
            case "terminal.run_readonly":
            case "terminal.run":
              return dockerRun(root, ["sh", "-c", String(params["command"] ?? "")], definition.timeoutMs);
            case "filesystem.search": {
              const query = String(params["query"] ?? "");
              const glob = typeof params["glob"] === "string" && params["glob"] ? params["glob"] : "";
              const include = glob ? `--include=${shq(glob)} ` : "";
              return dockerRun(root, ["sh", "-c", `grep -rn -F ${include}-e ${shq(query)} /workspace`], definition.timeoutMs);
            }
            case "filesystem.rename":
              return dockerRun(
                root,
                ["sh", "-c", `mv /workspace/${sanitizeRel(String(params["from"] ?? ""))} /workspace/${sanitizeRel(String(params["to"] ?? ""))}`],
                definition.timeoutMs,
              );
            case "filesystem.delete":
              return dockerRun(root, ["sh", "-c", `rm -rf /workspace/${sanitizeRel(String(params["path"] ?? ""))}`], definition.timeoutMs);
            case "git.status":
              return dockerRun(root, ["sh", "-c", "git status --porcelain=v1 -b"], definition.timeoutMs);
            case "git.diff":
              return dockerRun(root, ["sh", "-c", params["staged"] ? "git diff --staged" : "git diff"], definition.timeoutMs);
            case "git.log": {
              const count = Math.min(Math.max(Number(params["count"] ?? 10) || 10, 1), 100);
              const author = typeof params["author"] === "string" && params["author"] ? ` --author=${shq(params["author"])}` : "";
              return dockerRun(root, ["sh", "-c", `git log -n ${count}${author}`], definition.timeoutMs);
            }
            case "git.branch": {
              const name = typeof params["name"] === "string" && params["name"] ? params["name"] : "";
              const startPoint = typeof params["startPoint"] === "string" && params["startPoint"] ? params["startPoint"] : "";
              const cmd = name ? `git branch ${shq(name)}${startPoint ? ` ${shq(startPoint)}` : ""}` : "git branch -a";
              return dockerRun(root, ["sh", "-c", cmd], definition.timeoutMs);
            }
            case "git.commit": {
              const message = String(params["message"] ?? "");
              const files = Array.isArray(params["files"]) ? (params["files"] as unknown[]).map((f) => shq(String(f))) : [];
              const add = files.length > 0 ? `git add ${files.join(" ")}` : "git add -A";
              return dockerRun(
                root,
                ["sh", "-c", `${add} && git -c user.email=aiharness@local -c user.name=AI-Harness commit -m ${shq(message)}`],
                definition.timeoutMs,
              );
            }
            case "git.blame":
              return dockerRun(root, ["sh", "-c", `git blame ${shq(sanitizeRel(String(params["path"] ?? "")))}`], definition.timeoutMs);
            case "git.merge":
              return dockerRun(root, ["sh", "-c", `git merge ${shq(String(params["branch"] ?? ""))}`], definition.timeoutMs);
            case "git.stash": {
              const action = String(params["action"] ?? "list");
              const message = typeof params["message"] === "string" && params["message"] ? params["message"] : "";
              const cmd =
                action === "push" ? `git stash push${message ? ` -m ${shq(message)}` : ""}` : action === "pop" ? "git stash pop" : "git stash list";
              return dockerRun(root, ["sh", "-c", cmd], definition.timeoutMs);
            }
            default:
              throw errors.bridgeDisconnected(`tool ${definition.name} has no sandbox executor`);
          }
        };
      }

      if (environment === "INTERNAL" && definition.name === "mcp.call") {
        const baseInternal = await base.resolve(environment, definition);
        return async (input: unknown, signal: AbortSignal, ctx?: { taskId?: string; runId?: string }) => {
          const params = (input ?? {}) as { serverId: string; mcpToolName: string; args?: Record<string, unknown> };
          const server = await prisma.mcpServer.findUnique({ where: { id: params.serverId } }).catch(() => null);
          if (!server) throw Object.assign(new Error("MCP server not found"), { code: "NOT_FOUND" });
          if (server.transportType === "STDIO") {
            return stdioViaBridge(prisma, ctx?.taskId ?? "", server.ownerId, params, definition.timeoutMs);
          }
          return baseInternal(input, signal);
        };
      }

      // Deploy tools: delegate to DeploymentEngine
      if (environment === "INTERNAL" && definition.name.startsWith("deploy.")) {
        return async (input: unknown, _signal: AbortSignal, ctx?: { taskId?: string; runId?: string }) => {
          const params = (input ?? {}) as Record<string, unknown>;
          const engine = new DeploymentEngine(prisma, (event, data) => {
            if (event === "deployment:status" && data && typeof data === "object" && "deploymentId" in data) {
              onDeploymentStatus?.(data as { deploymentId: string; status: string; failureReason?: string });
            }
          });

          switch (definition.name) {
            case "deploy.start": {
              const result = await engine.startDeployment({
                projectId: String(params["projectId"] ?? ""),
                userId: "system",
                taskId: ctx?.taskId ?? (typeof params["taskId"] === "string" ? params["taskId"] : undefined),
                checkpointId: typeof params["checkpointId"] === "string" ? params["checkpointId"] : undefined,
                buildCommand: typeof params["buildCommand"] === "string" ? params["buildCommand"] : "npm run build",
                environment: (params["environment"] as "production" | "preview" | "staging") ?? "production",
                outputDir: typeof params["outputDir"] === "string" ? params["outputDir"] : undefined,
              });
              return { deploymentId: result.deploymentId, status: result.status };
            }
            case "deploy.status": {
              const deploymentId = String(params["deploymentId"] ?? "");
              const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
              if (!deployment) throw Object.assign(new Error("Deployment not found"), { code: "NOT_FOUND" });
              return {
                id: deployment.id,
                status: deployment.status,
                environment: deployment.environment,
                deploymentUrl: deployment.deploymentUrl,
                failureReason: deployment.failureReason,
              };
            }
            case "deploy.logs": {
              const deploymentId = String(params["deploymentId"] ?? "");
              const stream = String(params["stream"] ?? "build");
              const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
              if (!deployment) throw Object.assign(new Error("Deployment not found"), { code: "NOT_FOUND" });
              const logs = stream === "runtime" ? deployment.runtimeLogs : deployment.buildLogs;
              return { logs: logs ?? "", totalLines: (logs ?? "").split("\n").filter(Boolean).length };
            }
            default:
              throw Object.assign(new Error(`Unknown deploy tool: ${definition.name}`), { code: "TOOL_NOT_FOUND" });
          }
        };
      }

      return base.resolve(environment, definition);
    },
  };
}

const sandboxLog = createLogger({ name: "sandbox" });
function getSafeRoot(root: string): boolean {
  try { execSync("docker info", { stdio: "ignore" }); } catch (err) { sandboxLog.warn({ err }, "Docker not available"); return false; }
  if (!path.isAbsolute(root)) return false;
  try {
    return statSync(path.normalize(root)).isDirectory();
  } catch (err) {
    sandboxLog.warn({ err }, "Failed to stat root directory");
    return false;
  }
}

function sanitizeRel(rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/(\.\.[\\/])|\.\.$/g, "").replace(/^\/+/, "");
  if (cleaned.includes("..")) throw Object.assign(new Error("traversal rejected"), { code: "POLICY_DENIED" });
  return cleaned;
}

/** Single-quote a value for sh -c interpolation. */
function shq(s: string): string {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/** STDIO MCP servers execute on the user's machine through their connected bridge. */
async function stdioViaBridge(
  prisma: PrismaClient,
  taskId: string,
  ownerId: string,
  params: { serverId: string; mcpToolName: string; args?: Record<string, unknown> },
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const server = await prisma.mcpServer.findUnique({ where: { id: params.serverId } });
  if (!server) throw Object.assign(new Error("MCP server not found"), { code: "NOT_FOUND" });
  // F-13: a disabled server must not receive calls. The HTTP/SSE path checks
  // this inside the base resolver; the STDIO branch returns before that, so
  // enforce it here (single choke point for bridge-mediated calls).
  if (server.status !== "ACTIVE") {
    throw Object.assign(new Error("MCP server is disabled"), { code: "POLICY_DENIED" });
  }

  let taskOwnerId = ownerId;
  if (taskId) {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { createdBy: true } });
    taskOwnerId = task?.createdBy ?? ownerId;
  }
  const bridge = await prisma.bridge.findFirst({
    where: { userId: taskOwnerId, status: "CONNECTED" },
    select: { id: true },
  });
  if (!bridge) throw errors.bridgeDisconnected("STDIO MCP requires a connected Local Bridge");

  const env = getEnv();
  const config = JSON.parse(decryptSecret(Buffer.from(server.encryptedConfig), env.ENCRYPTION_KEY)) as {
    command?: string;
    args?: string[];
  };
  if (!config.command) throw Object.assign(new Error("config.command required"), { code: "VALIDATION_ERROR" });

  // One-shot JSON-RPC over stdin, executed on the owner's connected bridge.
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: params.mcpToolName, arguments: params.args ?? {} } };
  const env3 = getEnv();
  const client = new BridgeGatewayClient({ baseUrl: env3.BRIDGE_GATEWAY_URL, internalToken: env3.BRIDGE_INTERNAL_TOKEN });
  const response = await client.execute(
    bridge.id,
    "mcp.stdio",
    { command: config.command!, args: config.args ?? [], rpc },
    timeoutMs,
  );

  if (!response.ok) {
    throw Object.assign(new Error(response.error?.message ?? "stdio mcp failed"), {
      code: response.error?.code ?? "BRIDGE_DISCONNECTED",
    });
  }
  return response.data ?? {};
}
