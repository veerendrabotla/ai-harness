import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BridgeGatewayClient, errors, getEnv } from "@ai-harness/shared";
import { randomUUID } from "node:crypto";
import { ok, reqParam } from "../../lib/http.js";

const runSchema = z.object({
  command: z.string().min(1).max(4096),
  cwd: z.string().default("."),
  timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
});

interface HistoryEntry {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  output: string;
  exitCode: number;
  createdAt: Date;
  durationMs: number;
}

// Per-project command history
const historyByProject = new Map<string, HistoryEntry[]>();
const MAX_HISTORY = 100;

async function resolveBridge(projectId: string, prisma: FastifyInstance["prisma"]) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { bridge: true },
  });
  if (!project) throw errors.notFound("Project");
  if (project.connectionType !== "LOCAL_BRIDGE" || !project.bridgeId || !project.bridge) {
    throw errors.projectUnavailable("Terminal requires a Local Bridge project");
  }
  if (project.bridge.status !== "CONNECTED") {
    throw errors.bridgeDisconnected("The bridge owning this project is not connected");
  }
  return { project, bridge: project.bridge };
}

function gateway(_app: FastifyInstance) {
  const env = getEnv();
  return new BridgeGatewayClient({ baseUrl: env.BRIDGE_GATEWAY_URL, internalToken: env.BRIDGE_INTERNAL_TOKEN });
}

function addHistory(projectId: string, entry: HistoryEntry): void {
  if (!historyByProject.has(projectId)) historyByProject.set(projectId, []);
  const list = historyByProject.get(projectId)!;
  list.unshift(entry);
  if (list.length > MAX_HISTORY) list.pop();
}

/**
 * Standalone terminal execution API.
 * Runs commands through the Bridge Gateway using `term.run` kind.
 * Stores command history per project for the terminal UI.
 */
export function registerTerminalRoutes(app: FastifyInstance) {
  // Execute a command
  app.post("/v1/projects/:projectId/terminal/run", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = runSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const gw = gateway(app);
    const start = Date.now();

    // Use "term.run" kind which the bridge agent handles (not "terminal.run")
    const response = await gw.execute(
      bridge.id,
      "term.run",
      { root: project.rootReference, command: input.command, cwd: input.cwd },
      input.timeoutMs,
    );
    const durationMs = Date.now() - start;

    const id = randomUUID();
    let stdout = "";
    let stderr = "";
    let exitCode = 1;

    if (response.ok && response.data) {
      stdout = String(response.data.stdout ?? "");
      stderr = String(response.data.stderr ?? "");
      exitCode = typeof response.data.exitCode === "number" ? response.data.exitCode : 0;
    } else {
      stderr = response.error?.message ?? "Execution failed";
    }

    const entry: HistoryEntry = {
      id,
      command: input.command,
      stdout,
      stderr,
      output: stdout + (stderr ? "\n" + stderr : ""),
      exitCode,
      createdAt: new Date(),
      durationMs,
    };
    addHistory(projectId, entry);

    return ok(reply, {
      id: entry.id,
      command: entry.command,
      stdout: entry.stdout,
      stderr: entry.stderr,
      output: entry.output,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      createdAt: entry.createdAt.toISOString(),
    });
  });

  // Get command history for a project
  app.get("/v1/projects/:projectId/terminal/history", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await app.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const entries = historyByProject.get(projectId) ?? [];

    return ok(reply, entries.map((e) => ({
      id: e.id,
      command: e.command,
      stdout: e.stdout,
      stderr: e.stderr,
      output: e.output,
      exitCode: e.exitCode,
      durationMs: e.durationMs,
      createdAt: e.createdAt.toISOString(),
    })));
  });

  // Clear command history for a project
  app.delete("/v1/projects/:projectId/terminal/history", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await app.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    historyByProject.delete(projectId);
    return ok(reply, { success: true });
  });
}
