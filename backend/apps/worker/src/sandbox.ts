import type { PrismaClient } from "@prisma/client";
import { execSync, spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
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

/**
 * Composite resolver:
 * - LOCAL_BRIDGE / INTERNAL → base gateway+MCP/HTTP resolvers
 * - CLOUD_SANDBOX → ephemeral Docker container per call when SANDBOX_MODE=docker
 *   (project root mounted read-write at /workspace; network disabled by default
 *   except for http.request which runs on the host instead).
 */
export function buildCompositeResolver(
  prisma: PrismaClient,
  mcpRegistry?: MCPRegistry,
  onDeploymentStatus?: (data: { deploymentId: string; status: string; failureReason?: string }) => void,
): ExecutionEnvironmentResolver {
  const base = buildBaseResolver(prisma, mcpRegistry);
  const env = getEnv();
  const sandboxEnabled = env["SANDBOX_MODE"] === "docker";

  const dockerRun = (root: string, argv: string[], timeoutMs: number, extraArgs: string[] = []): Promise<Record<string, unknown>> =>
    new Promise((resolveP, rejectP) => {
      const image = env["SANDBOX_IMAGE"] || "node:22-alpine";
      const args = [
        "run", "--rm",
        "-v", `${root}:/workspace`,
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
          const params = (input ?? {}) as Record<string, unknown>;
          const root = typeof params["root"] === "string" ? params["root"] : "";
          if (!root || !getSafeRoot(root)) throw errors.validation("sandbox tools require a valid registered root path");

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
              const tmpFile = path.join(os.tmpdir(), `aiharness-write-${Date.now()}-${Math.random().toString(36).slice(2)}`);
              await fs.writeFile(tmpFile, content, "utf8");
              try {
                return await dockerRun(root, ["sh", "-c", `cp /host-tmp/${path.basename(tmpFile)} /workspace/${rel}`], definition.timeoutMs, [`-v`, `${tmpFile}:/host-tmp/${path.basename(tmpFile)}:ro`]);
              } finally {
                await fs.unlink(tmpFile).catch((err) => {
                  sandboxLog.warn({ err }, "Failed to clean temp file");
                });
              }
            }
            case "terminal.run_readonly":
            case "terminal.run":
              return dockerRun(root, ["sh", "-c", String(params["command"] ?? "")], definition.timeoutMs);
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
