/**
 * Execution Trace Routes.
 * Query execution traces for tasks.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

export default function registerExecutionTraceRoutes(app: FastifyInstance) {
  /**
   * List execution traces for a task.
   */
  app.get<{
    Params: { taskId: string };
  }>("/v1/tasks/:taskId/traces", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["execution-traces"],
      summary: "List execution traces for a task",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { taskId } = req.params as { taskId: string };

    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");

    const traces = await app.prisma.executionTrace.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return ok(reply, { traces });
  });

  /**
   * Get a single execution trace.
   */
  app.get<{
    Params: { traceId: string };
  }>("/v1/traces/:traceId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["execution-traces"],
      summary: "Get an execution trace by ID",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { traceId } = req.params as { traceId: string };

    const trace = await app.prisma.executionTrace.findUnique({
      where: { id: traceId },
      include: { task: { select: { workspaceId: true } } },
    });
    if (!trace) throw errors.notFound("Execution trace");
    await app.requireWorkspaceRole(req, trace.task.workspaceId, "VIEWER");

    return ok(reply, trace);
  });
}
