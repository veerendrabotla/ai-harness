/**
 * Task Diff API Routes.
 * Compare task states and show differences.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

interface TaskSnapshot {
  id: string;
  goal: string;
  state: string;
  agentMode: string;
  createdAt: string;
  updatedAt: string;
}

interface DiffResult {
  field: string;
  before: unknown;
  after: unknown;
  type: "added" | "removed" | "changed";
}

export default function registerTaskDiffRoutes(app: FastifyInstance) {
  /**
   * Get task state snapshot at a point in time.
   */
  app.get<{
    Params: { taskId: string };
  }>("/v1/tasks/:taskId/snapshot", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks", "diff"],
      summary: "Get task state snapshot",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const taskId = (req.params as { taskId: string }).taskId;

    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        goal: true,
        state: true,
        agentMode: true,
        createdAt: true,
        updatedAt: true,
        workspaceId: true,
      },
    });

    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");

    const snapshot: TaskSnapshot = {
      id: task.id,
      goal: task.goal,
      state: task.state,
      agentMode: task.agentMode,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };

    return ok(reply, snapshot);
  });

  /**
   * Compare two task snapshots.
   */
  app.post<{
    Body: { taskId: string; compareWith?: string };
  }>("/v1/tasks/diff", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks", "diff"],
      summary: "Compare task states",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string", format: "uuid" },
          compareWith: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const { taskId, compareWith } = req.body as { taskId: string; compareWith?: string };

    // Get current task state
    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        goal: true,
        state: true,
        agentMode: true,
        createdAt: true,
        updatedAt: true,
        workspaceId: true,
      },
    });

    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");

    // If no comparison target, compare with initial state
    if (!compareWith) {
      const diffs: DiffResult[] = [];

      if (task.state !== "QUEUED") {
        diffs.push({ field: "state", before: "QUEUED", after: task.state, type: "changed" });
      }

      return ok(reply, {
        taskId,
        compareWith: "initial",
        diffs,
        summary: {
          totalChanges: diffs.length,
          added: diffs.filter((d) => d.type === "added").length,
          removed: diffs.filter((d) => d.type === "removed").length,
          changed: diffs.filter((d) => d.type === "changed").length,
        },
      });
    }

    // Compare with another task
    const otherTask = await app.prisma.task.findUnique({
      where: { id: compareWith },
      select: {
        id: true,
        goal: true,
        state: true,
        agentMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!otherTask) throw errors.notFound("Comparison task");

    const diffs: DiffResult[] = [];
    const fields = ["goal", "state", "agentMode"] as const;

    for (const field of fields) {
      const before = otherTask[field];
      const after = task[field];

      if (before !== after) {
        diffs.push({
          field,
          before,
          after,
          type: !before ? "added" : !after ? "removed" : "changed",
        });
      }
    }

    return ok(reply, {
      taskId,
      compareWith,
      diffs,
      summary: {
        totalChanges: diffs.length,
        added: diffs.filter((d) => d.type === "added").length,
        removed: diffs.filter((d) => d.type === "removed").length,
        changed: diffs.filter((d) => d.type === "changed").length,
      },
    });
  });

  /**
   * Get task events timeline for comparison.
   */
  app.get<{
    Params: { taskId: string };
  }>("/v1/tasks/:taskId/timeline", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks", "diff"],
      summary: "Get task event timeline",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const taskId = (req.params as { taskId: string }).taskId;

    const task = await app.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspaceId: true },
    });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");

    const events = await app.prisma.taskEvent.findMany({
      where: { taskId },
      select: {
        id: true,
        eventType: true,
        actorType: true,
        payload: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    return ok(reply, events);
  });
}
