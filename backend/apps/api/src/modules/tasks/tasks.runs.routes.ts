import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";

export default function registerTaskRunsRoutes(app: FastifyInstance) {
  app.get("/v1/tasks/runs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "List task runs across the workspace",
    },
  }, async (req, reply) => {
    const { workspaceId, limit = "50" } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (workspaceId) {
      where.task = { workspaceId };
    }

    const runs = await app.prisma.taskRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: parseInt(limit),
      include: {
        task: {
          select: { id: true, goal: true, state: true, workspaceId: true },
        },
      },
    });

    return ok(reply, { runs });
  });

  app.get<{
    Params: { runId: string };
  }>("/v1/tasks/runs/:runId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Get a specific task run",
    },
  }, async (req, reply) => {
    const { runId } = req.params as { runId: string };

    const run = await app.prisma.taskRun.findUnique({
      where: { id: runId },
      include: {
        task: {
          select: { id: true, goal: true, state: true, workspaceId: true },
        },
      },
    });

    if (!run) {
      return reply.code(404).send({ error: "Task run not found" });
    }

    return ok(reply, { run });
  });
}
