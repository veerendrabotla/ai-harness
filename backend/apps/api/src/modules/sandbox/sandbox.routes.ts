/**
 * Cloud Sandbox API Routes.
 * Provides isolated execution environments for cloud-mode projects.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { AppError, errors } from "@ai-harness/shared";
import { SandboxEngine } from "@ai-harness/sandbox-engine";
import { ok, reqParam } from "../../lib/http.js";

const engine = new SandboxEngine();

async function requireSandboxAccess(request: FastifyRequest, sandboxId: string) {
  const sandbox = engine.getSandbox(sandboxId);
  if (!sandbox) throw errors.notFound("Sandbox");
  if (sandbox.workspaceId) {
    await request.server.requireWorkspaceRole(request, sandbox.workspaceId, "MEMBER");
  }
  return sandbox;
}

const createSandboxSchema = z.object({
  name: z.string().min(1).max(120),
  workspaceId: z.string().uuid(),
  nodeVersion: z.string().optional(),
  env: z.record(z.string()).optional(),
});

const executeSchema = z.object({
  command: z.string().min(1).max(2048),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().int().min(1000).max(600_000).optional(),
});

const writeFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export function registerSandboxRoutes(app: FastifyInstance): void {
  // ── Create sandbox ────────────────────────────────────────
  app.post<{
    Body: z.infer<typeof createSandboxSchema>;
  }>("/v1/sandboxes", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Create a new cloud sandbox",
    },
  }, async (request, reply) => {
    try {
      const input = createSandboxSchema.parse(request.body);
      await app.requireWorkspaceRole(request, input.workspaceId, "MEMBER");

      const sandbox = await engine.createSandbox({
        name: input.name,
        workspaceId: input.workspaceId,
        nodeVersion: input.nodeVersion,
        env: input.env,
      });

      return reply.code(201).send({
        id: sandbox.id,
        name: sandbox.name,
        rootDir: sandbox.rootDir,
        status: sandbox.status,
        createdAt: sandbox.createdAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── List sandboxes ────────────────────────────────────────
  app.get<{
    Querystring: { workspaceId?: string };
  }>("/v1/sandboxes", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "List sandboxes for a workspace",
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (request, reply) => {
    const query = (request.query ?? {}) as { workspaceId?: string };
    if (!query.workspaceId) {
      return reply.code(400).send({ error: "workspaceId query parameter required" });
    }
    await app.requireWorkspaceRole(request, query.workspaceId, "VIEWER");

    const sandboxes = engine.listSandboxes().filter((s) => s.workspaceId === query.workspaceId);
    return ok(reply, sandboxes.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    })));
  });

  // ── Get sandbox ───────────────────────────────────────────
  app.get<{
    Params: { sandboxId: string };
  }>("/v1/sandboxes/:sandboxId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Get sandbox details",
    },
  }, async (request, reply) => {
    const sandboxId = reqParam(request, "sandboxId");
    const sandbox = await requireSandboxAccess(request, sandboxId);

    return ok(reply, {
      id: sandbox.id,
      name: sandbox.name,
      rootDir: sandbox.rootDir,
      status: sandbox.status,
      createdAt: sandbox.createdAt.toISOString(),
      processCount: sandbox.processes.size,
    });
  });

  // ── Write file ────────────────────────────────────────────
  app.post<{
    Params: { sandboxId: string };
    Body: z.infer<typeof writeFileSchema>;
  }>("/v1/sandboxes/:sandboxId/files", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Write a file to the sandbox",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);
      const input = writeFileSchema.parse(request.body);

      await engine.writeFile(sandboxId, input.path, input.content);

      return ok(reply, { success: true });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Read file ─────────────────────────────────────────────
  app.get<{
    Params: { sandboxId: string };
    Querystring: { path: string };
  }>("/v1/sandboxes/:sandboxId/files", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Read a file from the sandbox",
    },
  }, async (request, reply) => {
    const sandboxId = reqParam(request, "sandboxId");
    await requireSandboxAccess(request, sandboxId);
    const path = request.query.path;
    if (!path) return reply.code(400).send({ error: "path query parameter required" });

    try {
      const content = await engine.readFile(sandboxId, path);
      return ok(reply, { path, content });
    } catch (err) {
      request.log.error({ err }, "[Sandbox] Failed to read file:");
      return reply.code(404).send({ error: "File not found" });
    }
  });

  // ── List files ────────────────────────────────────────────
  app.get<{
    Params: { sandboxId: string };
    Querystring: { path?: string };
  }>("/v1/sandboxes/:sandboxId/files/list", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "List files in the sandbox",
    },
  }, async (request, reply) => {
    const sandboxId = reqParam(request, "sandboxId");
    await requireSandboxAccess(request, sandboxId);
    const path = request.query.path ?? ".";

    try {
      const files = await engine.listFiles(sandboxId, path);
      return ok(reply, files);
    } catch (err) {
      request.log.error({ err }, "[Sandbox] Failed to list files:");
      return reply.code(404).send({ error: "Directory not found" });
    }
  });

  // ── Execute command ───────────────────────────────────────
  app.post<{
    Params: { sandboxId: string };
    Body: z.infer<typeof executeSchema>;
  }>("/v1/sandboxes/:sandboxId/execute", {
    config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Execute a command in the sandbox",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);
      const input = executeSchema.parse(request.body);

      const result = await engine.execute(sandboxId, input.command, {
        cwd: input.cwd,
        env: input.env,
        timeout: input.timeout,
      });

      return ok(reply, {
        processId: result.processId,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Install dependencies ──────────────────────────────────
  app.post<{
    Params: { sandboxId: string };
    Body: { packageManager?: string };
  }>("/v1/sandboxes/:sandboxId/install", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Install dependencies in the sandbox",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);
      const packageManager = (request.body as { packageManager?: string })?.packageManager ?? "npm";

      const result = await engine.installDependencies(sandboxId, packageManager);

      return ok(reply, {
        exitCode: result.exitCode,
        output: result.output,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Build ─────────────────────────────────────────────────
  app.post<{
    Params: { sandboxId: string };
    Body: { buildCommand?: string };
  }>("/v1/sandboxes/:sandboxId/build", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Run a build in the sandbox",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);
      const buildCommand = (request.body as { buildCommand?: string })?.buildCommand ?? "npm run build";

      const result = await engine.build(sandboxId, buildCommand);

      return ok(reply, {
        exitCode: result.exitCode,
        output: result.output,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Start dev server ──────────────────────────────────────
  app.post<{
    Params: { sandboxId: string };
    Body: { command?: string; port?: number };
  }>("/v1/sandboxes/:sandboxId/dev-server", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Start a development server in the sandbox",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);
      const body = (request.body as { command?: string; port?: number }) ?? {};
      const command = body.command ?? "npm run dev";
      const port = body.port ?? 3000;

      const result = await engine.startDevServer(sandboxId, command, port);

      return ok(reply, {
        processId: result.processId,
        url: result.url,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Stop process ──────────────────────────────────────────
  app.post<{
    Params: { sandboxId: string; processId: string };
  }>("/v1/sandboxes/:sandboxId/processes/:processId/stop", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Stop a process in the sandbox",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);
      const processId = request.params.processId;

      await engine.stopProcess(sandboxId, processId);

      return ok(reply, { success: true });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Get process logs ──────────────────────────────────────
  app.get<{
    Params: { sandboxId: string; processId: string };
    Querystring: { offset?: string };
  }>("/v1/sandboxes/:sandboxId/processes/:processId/logs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Get process logs",
    },
  }, async (request, reply) => {
    const sandboxId = reqParam(request, "sandboxId");
    await requireSandboxAccess(request, sandboxId);
    const processId = request.params.processId;
    const offset = Number(request.query.offset ?? "0");

    try {
      const logs = engine.getProcessLogs(sandboxId, processId, offset);
      return ok(reply, logs);
    } catch (err) {
      request.log.error({ err }, "[Sandbox] Failed to get process logs:");
      return reply.code(404).send({ error: "Process not found" });
    }
  });

  // ── Delete file ───────────────────────────────────────────
  app.delete<{
    Params: { sandboxId: string };
    Querystring: { path: string };
  }>("/v1/sandboxes/:sandboxId/files", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Delete a file from the sandbox",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);
      const path = request.query.path;
      if (!path) return reply.code(400).send({ error: "path query parameter required" });

      await engine.deletePath(sandboxId, path);

      return ok(reply, { success: true });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Destroy sandbox ───────────────────────────────────────
  app.delete<{
    Params: { sandboxId: string };
  }>("/v1/sandboxes/:sandboxId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["sandbox"],
      summary: "Destroy a sandbox and clean up resources",
    },
  }, async (request, reply) => {
    try {
      const sandboxId = reqParam(request, "sandboxId");
      await requireSandboxAccess(request, sandboxId);

      await engine.destroySandbox(sandboxId);

      return ok(reply, { success: true });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });
}
