import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createTaskRequestSchema } from "@ai-harness/contracts";
import { AppError, errors, publishTaskControl, type TaskJob, redactValue } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import type { EventPublisher } from "@ai-harness/agent-runtime";
import { ok, reqParam } from "../../lib/http.js";
import { withCache } from "../../lib/cache.js";
import { getSharedRedis } from "../../lib/redis.js";

export default function registerTaskRoutes(
  app: FastifyInstance,
  events: EventPublisher,
  enqueue: (job: TaskJob) => Promise<void>,
) {
  const audit = createAuditRepository(app.prisma);

  app.get("/v1/tasks", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "List tasks for the authenticated user",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          state: { type: "string" },
          limit: { type: "string" },
          includeArchived: { type: "string", enum: ["true", "false"] },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId?: string; state?: string; limit?: string; includeArchived?: string };
    const userId = req.user!.sub;
    const memberships = await withCache(`memberships:user:${userId}`, 30, () =>
      app.prisma.workspaceMember.findMany({
        where: { userId },
        select: { workspaceId: true },
      }),
    );
    const workspaceIds = memberships.map((m) => m.workspaceId);
    const cacheKey = `tasks:user:${userId}:${query.workspaceId ?? "all"}:${query.state ?? "any"}:${query.includeArchived ?? "false"}`;
    const tasks = await withCache(cacheKey, 15, () =>
      app.prisma.task.findMany({
        where: {
          workspaceId: query.workspaceId
            ? (workspaceIds.includes(query.workspaceId) ? query.workspaceId : "__denied__")
            : { in: workspaceIds },
          ...(query.state ? { state: query.state as "QUEUED" | "INITIALIZING" | "UNDERSTANDING" | "GATHERING_CONTEXT" | "PLANNING" | "WAITING_FOR_APPROVAL" | "EXECUTING" | "WAITING_FOR_TOOL_APPROVAL" | "OBSERVING" | "REPLANNING" | "VERIFYING" | "REVIEWING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED" } : {}),
          ...(query.includeArchived !== "true" ? { archivedAt: null } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: query.limit ? parseInt(query.limit) : 100,
      }),
    );

    // Fetch aggregated usage for these tasks
    const taskIds = tasks.map((t) => t.id);
    const usageAggregates = await app.prisma.taskRun.groupBy({
      by: ["taskId"],
      where: { taskId: { in: taskIds } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
    });
    const usageMap = new Map(usageAggregates.map((u) => [u.taskId, u._sum]));

    return ok(reply, tasks.map((t) => serializeTask({ ...t, _sum: usageMap.get(t.id) ?? null })));
  });

  app.post(
    "/v1/tasks",
    {
      preHandler: [app.authenticate],
      config: {
        rateLimit: { max: 30, timeWindow: "1 hour", keyGenerator: (r) => r.user?.sub ?? r.ip },
      },
      schema: {
        tags: ["tasks"],
        summary: "Create a new task and enqueue it for execution",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["workspaceId", "projectId", "goal"],
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            goal: { type: "string", minLength: 1, maxLength: 10000 },
            constraints: { type: "string", maxLength: 10000 },
            agentMode: { type: "string", enum: ["BUILD", "PLAN", "ASK", "REVIEW", "FIX"], default: "BUILD" },
            selectedModelMode: { type: "string", enum: ["MANUAL", "ROUTED"], default: "ROUTED" },
          },
        },

      },
    },
    async (req, reply) => {
      const input = createTaskRequestSchema.parse(req.body);
      const userId = req.user!.sub;

      // FR-002/FR-003: membership + one workspace + one project.
      await app.requireWorkspaceRole(req, input.workspaceId, "MEMBER");
      const workspace = await app.prisma.workspace.findUnique({
        where: { id: input.workspaceId },
      });
      if (!workspace) throw errors.notFound("Workspace");
      if (workspace.status === "ARCHIVED") throw errors.workspaceArchived(); // FR-020

      const project = await app.prisma.project.findFirst({
        where: { id: input.projectId, workspaceId: input.workspaceId },
      });
      if (!project) throw errors.notFound("Project");
      if (project.status !== "AVAILABLE") throw errors.projectUnavailable();

      let override = null;
      if (input.selectedModelMode === "MANUAL") {
        if (!input.modelOverride) throw errors.validation("Manual mode requires modelOverride");
        const conn = await app.prisma.providerConnection.findFirst({
          where: {
            id: input.modelOverride.providerConnectionId,
            status: "ACTIVE",
            workspaceLinks: { some: { workspaceId: input.workspaceId } },
          },
        });
        if (!conn) {
          throw errors.validation(
            "modelOverride must reference an ACTIVE provider connection linked to this workspace",
          );
        }
        override = input.modelOverride;
      }

      const task = await app.prisma.task.create({
        data: {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          createdBy: userId,
          goal: input.goal,
          constraints: input.constraints ?? null,
          state: "QUEUED",
          agentMode: input.agentMode,
          selectedModelMode: input.selectedModelMode,
          overrideProviderConnectionId: override?.providerConnectionId ?? null,
          overrideModelIdentifier: override?.modelIdentifier ?? null,
        },
      });
      await audit.record({
        actorUserId: userId,
        workspaceId: input.workspaceId,
        action: "TASK_CREATED",
        entityType: "TASK",
        entityId: task.id,
      });
      await events.publishAndEmit({
        taskId: task.id,
        runId: null,
        eventType: TASK_EVENT_TYPES.RUN_STARTED,
        actorType: "USER",
        payload: { createdBy: userId, note: "task queued" },
      });

      // Transactional outbox pattern: retry enqueue with backoff so a transient
      // Redis failure does not leave an orphaned QUEUED task. BullMQ dedup
      // (jobId) makes re-enqueue idempotent. Orphaned tasks are also
      // recovered by the worker sweeper (stuck-run recovery).
      let enqueued = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await enqueue({ kind: "start", taskId: task.id });
          enqueued = true;
          break;
        } catch (err) {
          if (attempt === 2) {
            req.log.error({ err: redactValue(err), taskId: task.id }, "failed to enqueue task after 3 attempts");
          } else {
            req.log.warn({ err: redactValue(err), taskId: task.id }, `enqueue attempt ${attempt + 1} failed, retrying`);
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
      if (!enqueued) {
        // Leave task as QUEUED — worker sweeper will re-enqueue orphaned QUEUED tasks
        req.log.warn({ taskId: task.id }, "task remains QUEUED; worker sweeper will retry enqueue");
      }

      return ok(reply, serializeTask(task), 201);
    },
  );

  app.get("/v1/tasks/:taskId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Get task details",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await withCache(`task:${taskId}`, 15, () =>
      app.prisma.task.findUnique({ where: { id: taskId } }),
    );
    if (!task) throw errors.notFound("Task");
    const role = await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");
    return ok(reply, { ...serializeTask(task), viewerRole: role.role });
  });

  app.get("/v1/tasks/:taskId/runs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "List runs for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const runs = await app.prisma.taskRun.findMany({
      where: { taskId },
      orderBy: { runNumber: "desc" },
      take: 100,
    });
    return ok(
      reply,
      runs.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        runNumber: r.runNumber,
        state: r.state,
        startedAt: r.startedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        failureCode: r.failureCode,
        failureMessage: r.failureMessage,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        totalTokens: r.totalTokens ?? 0,
        estimatedCost: r.estimatedCost ?? 0,
        modelUsed: r.modelUsed ?? null,
      })),
    );
  });

  app.post("/v1/tasks/:taskId/cancel", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Cancel a running task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const ctx = await loadTaskScoped(app, req, taskId, "MEMBER");
    const state = ctx.task.state;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(state)) {
      throw errors.conflict(`Task is already ${state}`);
    }

    await app.prisma.task.update({ where: { id: taskId }, data: { cancelRequested: true } });
    try {
      const redis = getSharedRedis();
      if (redis) {
        await publishTaskControl(redis, taskId, "cancel");
      }
    } catch (ctrlErr) {
      req.log.warn({ err: ctrlErr }, "control-bus cancel publish failed; flags remain");
    }
    await events.publishAndEmit({
      taskId,
      runId: null,
      eventType: TASK_EVENT_TYPES.CANCEL_REQUESTED,
      actorType: "USER",
      payload: { requestedBy: req.user!.sub },
    });

    // Immediate cancellation in states with no in-flight model/tool work.
    if (["QUEUED", "WAITING_FOR_APPROVAL", "WAITING_FOR_TOOL_APPROVAL"].includes(state)) {
      await app.prisma.task.update({
        where: { id: taskId },
        data: { state: "CANCELLED", completedAt: new Date(), cancelRequested: false },
      });
      const run = await app.prisma.taskRun.findFirst({
        where: { taskId, state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
        orderBy: { runNumber: "desc" },
      });
      if (run) {
        await app.prisma.taskRun.update({
          where: { id: run.id },
          data: { state: "CANCELLED", endedAt: new Date() },
        });
      }
      await events.publishAndEmit({
        taskId,
        runId: run?.id ?? null,
        eventType: TASK_EVENT_TYPES.RUN_CANCELLED,
        actorType: "USER",
        payload: {},
      });
      await audit.record({
        actorUserId: req.user!.sub,
        workspaceId: ctx.task.workspaceId,
        action: "TASK_CANCELLED",
        entityType: "TASK",
        entityId: taskId,
      });
    }
    return ok(reply, { id: taskId, cancelRequested: true });
  });

  /** Retry creates a NEW run (APP_FLOW §15). The task-level state is reset to QUEUED. */
  app.post("/v1/tasks/:taskId/retry", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Retry a completed or failed task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const ctx = await loadTaskScoped(app, req, taskId, "MEMBER");
    if (!["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(ctx.task.state)) {
      throw errors.conflict(`Retry requires a terminal or interrupted task (current: ${ctx.task.state})`);
    }
    await app.prisma.task.update({
      where: { id: taskId },
      data: {
        state: "QUEUED",
        cancelRequested: false,
        pauseRequested: false,
        completedAt: null,
      },
    });
    try {
      await enqueue({ kind: "start", taskId });
    } catch (err) {
      throw new AppError("INTERNAL_ERROR", "Queue unavailable; retry not scheduled", {
        reason: redactValue(err),
      });
    }
    return ok(reply, { id: taskId, state: "QUEUED" });
  });

  app.post("/v1/tasks/:taskId/pause", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Pause an active task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const ctx = await loadTaskScoped(app, req, taskId, "MEMBER");
    const PAUSABLE = [
      "QUEUED", "INITIALIZING", "UNDERSTANDING", "GATHERING_CONTEXT",
      "PLANNING", "EXECUTING", "OBSERVING", "REPLANNING",
    ];
    if (!PAUSABLE.includes(ctx.task.state)) {
      throw errors.conflict(`Cannot pause a task in state ${ctx.task.state}`);
    }
    await app.prisma.task.update({ where: { id: taskId }, data: { pauseRequested: true } });
    await events.publishAndEmit({
      taskId,
      runId: null,
      eventType: TASK_EVENT_TYPES.PAUSE_REQUESTED,
      actorType: "USER",
      payload: { requestedBy: req.user!.sub },
    });
    return ok(reply, { id: taskId, pauseRequested: true });
  });

  app.post("/v1/tasks/:taskId/resume", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Resume an interrupted task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const ctx = await loadTaskScoped(app, req, taskId, "MEMBER");
    if (ctx.task.state !== "INTERRUPTED") {
      throw errors.conflict(`Resume requires an INTERRUPTED task (current: ${ctx.task.state})`);
    }
    await app.prisma.task.update({
      where: { id: taskId },
      data: { state: "QUEUED", pauseRequested: false, cancelRequested: false },
    });
    try {
      await enqueue({ kind: "start", taskId });
    } catch (err) {
      throw new AppError("INTERNAL_ERROR", "Queue unavailable; resume not scheduled", {
        reason: redactValue(err),
      });
    }
    return ok(reply, { id: taskId, state: "QUEUED" });
  });

/**
 * Access a shared task via share token (public, no auth required).
 */
app.get("/v1/shared/task/:shareToken", {
  schema: {
    tags: ["tasks"],
    summary: "Access a shared task by token",
    params: {
      type: "object",
      required: ["shareToken"],
      properties: { shareToken: { type: "string" } },
    },
  },
}, async (req, reply) => {
  const shareToken = reqParam(req, "shareToken");
  const tokenHash = createHash("sha256").update(shareToken).digest("hex");

  const share = await app.prisma.sessionShare.findUnique({
    where: { tokenHash },
  });
  if (!share) throw errors.notFound("Shared task");
  if (share.expiresAt && share.expiresAt < new Date()) throw errors.notFound("Share link expired");

  const task = await app.prisma.task.findUnique({
    where: { id: share.taskId },
    include: {
      runs: {
        orderBy: { runNumber: "desc" },
        take: 5,
      },
    },
  });
  if (!task) throw errors.notFound("Task");

  const events = await app.prisma.taskEvent.findMany({
    where: { taskId: task.id },
    orderBy: { sequenceNumber: "asc" },
    take: 500,
  });

  const SAFE_EVENT_TYPES = new Set([
    "STATE_CHANGED",
    "PLAN_CREATED",
    "PLAN_APPROVED",
    "PLAN_REJECTED",
    "PLAN_REVISED",
    "TASK_COMPLETED",
    "TASK_FAILED",
    "TASK_CANCELLED",
  ]);

  return ok(reply, {
    task: {
      id: task.id,
      goal: task.goal,
      constraints: task.constraints,
      state: task.state,
      agentMode: task.agentMode,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    },
    events: events
      .filter((e) => SAFE_EVENT_TYPES.has(e.eventType))
      .map((e) => ({
        sequenceNumber: e.sequenceNumber,
        eventType: e.eventType,
        actorType: e.actorType,
        createdAt: e.createdAt.toISOString(),
      })),
    runs: task.runs.map((r) => ({
      runNumber: r.runNumber,
      state: r.state,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      failureCode: r.failureCode,
    })),
  });
});

/**
 * Export a task as markdown.
 */
app.get("/v1/tasks/:taskId/export/markdown", {
  preHandler: [app.authenticate],
  schema: {
    tags: ["tasks"],
    summary: "Export a task as markdown",
    params: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", format: "uuid" } },
    },
  },
}, async (req, reply) => {
  const taskId = reqParam(req, "taskId");
  const { task } = await loadTaskScoped(app, req, taskId);

  const events = await app.prisma.taskEvent.findMany({
    where: { taskId },
    orderBy: { sequenceNumber: "asc" },
    take: 1000,
  });

  const plans = await app.prisma.taskPlan.findMany({
    where: { taskId },
    orderBy: { version: "asc" },
    take: 100,
  });

  const toolCalls = await app.prisma.toolCall.findMany({
    where: { taskId },
    orderBy: { startedAt: "asc" },
    take: 500,
  });

  let md = `# Task: ${task.goal}\n\n`;
  md += `**State:** ${task.state}\n`;
  md += `**Created:** ${task.createdAt.toISOString()}\n`;
  if (task.completedAt) md += `**Completed:** ${task.completedAt.toISOString()}\n`;
  if (task.constraints) md += `**Constraints:** ${task.constraints}\n`;
  md += `\n---\n\n`;

  if (plans.length > 0) {
    md += `## Plans\n\n`;
    for (const plan of plans) {
      md += `### Version ${plan.version}\n\n`;
      const steps = plan.steps as Array<{
        id: string;
        title?: string;
        detail?: string;
        acceptanceCriteria?: string[];
      }> | null;
      if (steps) {
        for (const step of steps) {
          md += `- [ ] **${step.id}**: ${step.title ?? ""}${step.detail ? ` — ${step.detail}` : ""}\n`;
          for (const criterion of step.acceptanceCriteria ?? []) {
            md += `  - [ ] ${criterion}\n`;
          }
        }
      }
      md += `\n`;
    }
  }

  if (toolCalls.length > 0) {
    md += `## Tool Calls\n\n`;
    for (const tc of toolCalls) {
      md += `- **${tc.toolName}** (${tc.status}) — ${tc.riskLevel}\n`;
    }
    md += `\n`;
  }

  if (events.length > 0) {
    md += `## Activity Log\n\n`;
    for (const e of events) {
      md += `- [${e.eventType}] (${e.actorType}) — ${e.createdAt.toISOString()}\n`;
    }
  }

  reply.header("Content-Type", "text/markdown");
  reply.header("Content-Disposition", `attachment; filename="task-${task.id}.md"`);
  return reply.send(md);
});

/**
 * Export a task as JSON.
 */
app.get("/v1/tasks/:taskId/export/json", {
  preHandler: [app.authenticate],
  schema: {
    tags: ["tasks"],
    summary: "Export a task as JSON",
    params: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", format: "uuid" } },
    },
  },
}, async (req, reply) => {
  const taskId = reqParam(req, "taskId");
  const { task } = await loadTaskScoped(app, req, taskId);

  const [events, plans, toolCalls, runs] = await Promise.all([
    app.prisma.taskEvent.findMany({ where: { taskId }, orderBy: { sequenceNumber: "asc" }, take: 1000 }),
    app.prisma.taskPlan.findMany({ where: { taskId }, orderBy: { version: "asc" }, take: 100 }),
    app.prisma.toolCall.findMany({ where: { taskId }, orderBy: { startedAt: "asc" }, take: 500 }),
    app.prisma.taskRun.findMany({ where: { taskId }, orderBy: { runNumber: "asc" }, take: 100 }),
  ]);

  reply.header("Content-Type", "application/json");
  reply.header("Content-Disposition", `attachment; filename="task-${task.id}.json"`);
  return reply.send(JSON.stringify({
    task: serializeTask(task),
    events: events.map((e) => ({
      sequenceNumber: e.sequenceNumber,
      eventType: e.eventType,
      actorType: e.actorType,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    })),
    plans,
    toolCalls,
    runs,
  }, null, 2));
});

// ── Pin / Unpin ──────────────────────────────────────────────
app.post("/v1/tasks/:taskId/pin", {
  preHandler: [app.authenticate],
  schema: { tags: ["tasks"], summary: "Pin a task", security: [{ bearerAuth: [] }] },
}, async (req, reply) => {
  const { taskId } = (req as { params: { taskId: string } }).params;
  await app.prisma.$executeRawUnsafe(
    `UPDATE tasks SET is_pinned = $1, updated_at = NOW() WHERE id = $2`,
    true,
    taskId,
  );
  return ok(reply, { taskId, isPinned: true });
});

app.post("/v1/tasks/:taskId/unpin", {
  preHandler: [app.authenticate],
  schema: { tags: ["tasks"], summary: "Unpin a task", security: [{ bearerAuth: [] }] },
}, async (req, reply) => {
  const { taskId } = (req as { params: { taskId: string } }).params;
  await app.prisma.$executeRawUnsafe(
    `UPDATE tasks SET is_pinned = $1, updated_at = NOW() WHERE id = $2`,
    false,
    taskId,
  );
  return ok(reply, { taskId, isPinned: false });
});
}

async function loadTaskScoped(
  app: FastifyInstance,
  req: Parameters<FastifyInstance["authenticate"]>[0],
  taskId: string,
  minimum: "OWNER" | "MEMBER" | "VIEWER" = "VIEWER",
) {
  const task = await app.prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw errors.notFound("Task");
  const role = await app.requireWorkspaceRole(req, task.workspaceId, minimum);
  return { task, role: role.role };
}

function serializeTask(t: {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  goal: string;
  constraints: string | null;
  state: string;
  agentMode: string;
  selectedModelMode: string;
  overrideProviderConnectionId: string | null;
  overrideModelIdentifier: string | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  parentTaskId: string | null;
  // withCache JSON-round-trips, so cached reads yield strings — accept both.
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
  archivedAt: Date | string | null;
  _sum?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCost: number | null;
  } | null;
}) {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    createdBy: t.createdBy,
    goal: t.goal,
    constraints: t.constraints,
    state: t.state,
    agentMode: t.agentMode,
    selectedModelMode: t.selectedModelMode,
    overrideProviderConnectionId: t.overrideProviderConnectionId,
    overrideModelIdentifier: t.overrideModelIdentifier,
    cancelRequested: t.cancelRequested,
    pauseRequested: t.pauseRequested,
    parentTaskId: t.parentTaskId,
    createdAt: new Date(t.createdAt).toISOString(),
    updatedAt: new Date(t.updatedAt).toISOString(),
    completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
    archivedAt: t.archivedAt ? new Date(t.archivedAt).toISOString() : null,
    inputTokens: t._sum?.inputTokens ?? 0,
    outputTokens: t._sum?.outputTokens ?? 0,
    totalTokens: t._sum?.totalTokens ?? 0,
    estimatedCost: t._sum?.estimatedCost ?? 0,
  };
}

