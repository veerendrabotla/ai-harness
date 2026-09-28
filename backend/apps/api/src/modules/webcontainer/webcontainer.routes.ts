/**
 * WebContainer Routes.
 * Create, manage, and interact with WebContainer sessions.
 */
import type { FastifyInstance } from "fastify";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { errors } from "@ai-harness/shared";
import { ok, reqParam } from "../../lib/http.js";
import { getWebContainerManager } from "./webcontainer-manager.js";

const execAsync = promisify(exec);

const createSessionSchema = z.object({
  workspaceId: z.string().uuid(),
  ttlMs: z.number().int().min(60_000).max(3_600_000).optional(),
});

const COMMAND_TIMEOUT_MS = 10_000;

async function runCommand(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
    const exitCode = typeof e.code === "number" ? e.code : e.killed ? 124 : 1;
    return {
      exitCode,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? (err instanceof Error ? err.message : String(err))),
    };
  }
}

export function registerWebContainerRoutes(app: FastifyInstance): void {
  const manager = getWebContainerManager(app.prisma);

  // Create a new WebContainer session
  app.post<{
    Body: z.infer<typeof createSessionSchema>;
  }>("/v1/webcontainer/create", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "Create a new WebContainer session",
    },
  }, async (request, reply) => {
    const input = createSessionSchema.parse(request.body);
    await request.server.requireWorkspaceRole(
      request,
      input.workspaceId,
      "MEMBER",
    );

    const { sessionId } = await manager.create(input.workspaceId, input.ttlMs);
    return reply.code(201).send({ data: { sessionId }, requestId: reply.request.id });
  });

  // Sync files to the container
  app.post<{
    Params: { sessionId: string };
    Body: Record<string, string>;
  }>("/v1/webcontainer/:sessionId/files", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "Sync files to the WebContainer",
    },
  }, async (request, reply) => {
    const sessionId = reqParam(request, "sessionId");
    const session = await manager.getStatus(sessionId);
    if (!session) throw errors.notFound("WebContainer session");
    await request.server.requireWorkspaceRole(request, session.workspaceId, "MEMBER");

    const files = request.body as Record<string, unknown> | null;
    if (!files || typeof files !== "object" || Array.isArray(files)) {
      throw errors.validation("files must be an object mapping paths to contents");
    }
    const entries = Object.entries(files);
    if (entries.length === 0) throw errors.validation("files must not be empty");
    for (const [path, content] of entries) {
      if (typeof content !== "string") throw errors.validation(`content of "${path}" must be a string`);
    }

    const synced = await manager.syncFiles(sessionId, files as Record<string, string>);
    return ok(reply, { synced });
  });

  // Execute a command in the container
  app.post<{
    Params: { sessionId: string };
    Body: { command: string };
  }>("/v1/webcontainer/:sessionId/run", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "Execute a command in the WebContainer",
    },
  }, async (request, reply) => {
    const sessionId = reqParam(request, "sessionId");
    const session = await manager.getStatus(sessionId);
    if (!session) throw errors.notFound("WebContainer session");
    await request.server.requireWorkspaceRole(request, session.workspaceId, "MEMBER");

    const command = (request.body as { command?: unknown } | null)?.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw errors.validation("command is required");
    }

    const cwd = await manager.ensureSessionDir(sessionId);
    const result = await runCommand(command, cwd);
    return ok(reply, result);
  });

  // Get container status
  app.get<{
    Params: { sessionId: string };
  }>("/v1/webcontainer/:sessionId/status", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "Get WebContainer session status",
    },
  }, async (request, reply) => {
    const sessionId = reqParam(request, "sessionId");
    const status = await manager.getStatus(sessionId);
    if (!status) throw errors.notFound("WebContainer session");
    await request.server.requireWorkspaceRole(request, status.workspaceId, "MEMBER");
    return ok(reply, status);
  });

  // List sessions for a workspace
  app.get<{
    Querystring: { workspaceId: string };
  }>("/v1/webcontainer/sessions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "List WebContainer sessions for a workspace",
    },
  }, async (request, reply) => {
    const { workspaceId } = request.query as { workspaceId: string };
    if (!workspaceId) throw errors.validation("workspaceId is required");
    await request.server.requireWorkspaceRole(
      request,
      workspaceId,
      "MEMBER",
    );
    const sessions = await manager.listByWorkspace(workspaceId);
    return ok(reply, { sessions });
  });

  // Shutdown container
  app.delete<{
    Params: { sessionId: string };
  }>("/v1/webcontainer/:sessionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "Shutdown a WebContainer session",
    },
  }, async (request, reply) => {
    const sessionId = reqParam(request, "sessionId");
    const session = await manager.getStatus(sessionId);
    if (!session) throw errors.notFound("WebContainer session");
    await request.server.requireWorkspaceRole(request, session.workspaceId, "MEMBER");
    const success = await manager.shutdown(sessionId);
    if (!success) throw errors.notFound("WebContainer session");
    return ok(reply, { success: true });
  });
}
