import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

export default function registerTaskExportRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  app.get("/v1/tasks/:taskId/export", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Export a task as JSON (goal, config, runs, messages)",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");

    const [runs, events] = await Promise.all([
      app.prisma.taskRun.findMany({ where: { taskId }, orderBy: { runNumber: "asc" }, take: 5000 }),
      app.prisma.taskEvent.findMany({ where: { taskId }, orderBy: { sequenceNumber: "asc" }, take: 5000 }),
    ]);

    const exported = {
      task: {
        id: task.id,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        createdBy: task.createdBy,
        goal: task.goal,
        constraints: task.constraints,
        state: task.state,
        agentMode: task.agentMode,
        selectedModelMode: task.selectedModelMode,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
      },
      runs: runs.map((r) => ({
        id: r.id,
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
      events: events.map((e) => ({
        sequenceNumber: e.sequenceNumber,
        eventType: e.eventType,
        actorType: e.actorType,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
    };

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: task.workspaceId,
      action: "SESSION_EXPORTED",
      entityType: "TASK",
      entityId: taskId,
    });

    return ok(reply, exported);
  });

  app.post("/v1/tasks/:taskId/import", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Import a task from JSON (creates new task)",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const sourceTaskId = reqParam(req, "taskId");
    const body = (req.body ?? {}) as { targetWorkspaceId?: string; targetProjectId?: string };
    const userId = req.user!.sub;

    const sourceTask = await app.prisma.task.findUnique({ where: { id: sourceTaskId } });
    if (!sourceTask) throw errors.notFound("Source task");
    await app.requireWorkspaceRole(req, sourceTask.workspaceId, "VIEWER");

    const targetWorkspaceId = body.targetWorkspaceId ?? sourceTask.workspaceId;
    const targetProjectId = body.targetProjectId ?? sourceTask.projectId;

    await app.requireWorkspaceRole(req, targetWorkspaceId, "MEMBER");

    const targetProject = await app.prisma.project.findFirst({
      where: { id: targetProjectId, workspaceId: targetWorkspaceId },
    });
    if (!targetProject) throw errors.notFound("Target project");

    const [sourceRuns, sourceEvents] = await Promise.all([
      app.prisma.taskRun.findMany({ where: { taskId: sourceTaskId }, orderBy: { runNumber: "asc" } }),
      app.prisma.taskEvent.findMany({ where: { taskId: sourceTaskId }, orderBy: { sequenceNumber: "asc" } }),
    ]);

    const newTask = await app.prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: targetWorkspaceId,
        projectId: targetProjectId,
        createdBy: userId,
        goal: `[Imported] ${sourceTask.goal}`,
        constraints: sourceTask.constraints,
        state: "QUEUED",
        agentMode: sourceTask.agentMode,
        selectedModelMode: sourceTask.selectedModelMode,
      },
    });

    if (sourceRuns.length > 0) {
      await app.prisma.taskRun.createMany({
        data: sourceRuns.map((r) => ({
          id: randomUUID(),
          taskId: newTask.id,
          runNumber: r.runNumber,
          state: r.state as "QUEUED" | "INITIALIZING" | "UNDERSTANDING" | "GATHERING_CONTEXT" | "PLANNING" | "WAITING_FOR_APPROVAL" | "EXECUTING" | "WAITING_FOR_TOOL_APPROVAL" | "OBSERVING" | "REPLANNING" | "VERIFYING" | "REVIEWING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED",
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          failureCode: r.failureCode,
          failureMessage: r.failureMessage,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
          estimatedCost: r.estimatedCost,
          modelUsed: r.modelUsed,
        })),
      });
    }

    if (sourceEvents.length > 0) {
      await app.prisma.taskEvent.createMany({
        data: sourceEvents.map((e) => ({
          id: randomUUID(),
          taskId: newTask.id,
          sequenceNumber: e.sequenceNumber,
          eventType: e.eventType,
          actorType: e.actorType,
          payload: e.payload as unknown as Record<string, string>,
        })),
      });
    }

    await audit.record({
      actorUserId: userId,
      workspaceId: targetWorkspaceId,
      action: "SESSION_IMPORTED",
      entityType: "TASK",
      entityId: newTask.id,
      metadata: { sourceTaskId },
    });

    return ok(reply, { id: newTask.id, goal: newTask.goal }, 201);
  });

  app.get("/v1/tasks/export/workspace/:workspaceId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Export all tasks in a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    // Paginate through all tasks in the workspace
    const PAGE_SIZE = 500;
    let cursor: string | undefined;
    const allTasks: Awaited<ReturnType<typeof app.prisma.task.findMany>> = [];

    while (true) {
      const batch = await app.prisma.task.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      allTasks.push(...batch);
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < PAGE_SIZE) break;
    }

    const taskIds = allTasks.map((t) => t.id);

    // Paginate runs
    const allRuns: Awaited<ReturnType<typeof app.prisma.taskRun.findMany>> = [];
    for (let i = 0; i < taskIds.length; i += PAGE_SIZE) {
      const chunk = taskIds.slice(i, i + PAGE_SIZE);
      const runs = await app.prisma.taskRun.findMany({ where: { taskId: { in: chunk } }, orderBy: { runNumber: "asc" }, take: PAGE_SIZE });
      allRuns.push(...runs);
    }

    // Paginate events
    const allEvents: Awaited<ReturnType<typeof app.prisma.taskEvent.findMany>> = [];
    for (let i = 0; i < taskIds.length; i += PAGE_SIZE) {
      const chunk = taskIds.slice(i, i + PAGE_SIZE);
      const events = await app.prisma.taskEvent.findMany({ where: { taskId: { in: chunk } }, orderBy: { sequenceNumber: "asc" }, take: PAGE_SIZE });
      allEvents.push(...events);
    }

    const runsByTask = new Map<string, typeof allRuns>();
    for (const r of allRuns) {
      const list = runsByTask.get(r.taskId) ?? [];
      list.push(r);
      runsByTask.set(r.taskId, list);
    }

    const eventsByTask = new Map<string, typeof allEvents>();
    for (const e of allEvents) {
      const list = eventsByTask.get(e.taskId) ?? [];
      list.push(e);
      eventsByTask.set(e.taskId, list);
    }

    const exported = allTasks.map((task) => ({
      task: {
        id: task.id,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        createdBy: task.createdBy,
        goal: task.goal,
        constraints: task.constraints,
        state: task.state,
        agentMode: task.agentMode,
        selectedModelMode: task.selectedModelMode,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
      },
      runs: (runsByTask.get(task.id) ?? []).map((r) => ({
        id: r.id,
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
      events: (eventsByTask.get(task.id) ?? []).map((e) => ({
        sequenceNumber: e.sequenceNumber,
        eventType: e.eventType,
        actorType: e.actorType,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
    }));

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "SESSION_EXPORTED",
      entityType: "WORKSPACE_TASKS",
      entityId: workspaceId,
      metadata: { taskCount: allTasks.length },
    });

    return ok(reply, exported);
  });

  app.post("/v1/tasks/import/workspace/:workspaceId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["tasks"],
      summary: "Import tasks from JSON array into workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");
    const userId = req.user!.sub;

    const body = (req.body ?? {}) as {
      tasks?: Array<{
        task: { goal: string; constraints?: string | null; agentMode?: string; selectedModelMode?: string; projectId?: string };
        runs?: Array<{ state: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCost?: number; modelUsed?: string | null }>;
        events?: Array<{ eventType: string; actorType?: string; payload?: Record<string, unknown> }>;
      }>;
      targetProjectId?: string;
    };

    if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
      throw errors.validation("tasks array is required and must not be empty");
    }

    const workspace = await app.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw errors.notFound("Workspace");

    const created: Array<{ id: string; goal: string }> = [];

    for (const item of body.tasks) {
      const targetProjectId = body.targetProjectId ?? item.task.projectId;
      if (!targetProjectId) {
        throw errors.validation("Each task must have a projectId or provide targetProjectId");
      }

      const project = await app.prisma.project.findFirst({
        where: { id: targetProjectId, workspaceId },
      });
      if (!project) throw errors.notFound(`Project ${targetProjectId}`);

      const newTask = await app.prisma.task.create({
        data: {
          id: randomUUID(),
          workspaceId,
          projectId: targetProjectId,
          createdBy: userId,
          goal: `[Imported] ${item.task.goal}`,
          constraints: item.task.constraints ?? null,
          state: "QUEUED",
          agentMode: (item.task.agentMode as "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX") ?? "BUILD",
          selectedModelMode: (item.task.selectedModelMode as "MANUAL" | "ROUTED") ?? "ROUTED",
        },
      });

      if (item.runs && item.runs.length > 0) {
        await app.prisma.taskRun.createMany({
          data: item.runs.map((r, i) => ({
            id: randomUUID(),
            taskId: newTask.id,
            runNumber: i + 1,
            state: r.state as "QUEUED" | "INITIALIZING" | "UNDERSTANDING" | "GATHERING_CONTEXT" | "PLANNING" | "WAITING_FOR_APPROVAL" | "EXECUTING" | "WAITING_FOR_TOOL_APPROVAL" | "OBSERVING" | "REPLANNING" | "VERIFYING" | "REVIEWING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED",
            inputTokens: r.inputTokens ?? 0,
            outputTokens: r.outputTokens ?? 0,
            totalTokens: r.totalTokens ?? 0,
            estimatedCost: r.estimatedCost ?? 0,
            modelUsed: r.modelUsed ?? null,
          })),
        });
      }

      if (item.events && item.events.length > 0) {
        await app.prisma.taskEvent.createMany({
          data: item.events.map((e, i) => ({
            id: randomUUID(),
            taskId: newTask.id,
            sequenceNumber: BigInt(i + 1),
            eventType: e.eventType,
            actorType: (e.actorType as "USER" | "AGENT" | "SYSTEM" | null) ?? "SYSTEM",
            payload: (e.payload ?? {}) as Record<string, string>,
          })),
        });
      }

      created.push({ id: newTask.id, goal: newTask.goal });
    }

    await audit.record({
      actorUserId: userId,
      workspaceId,
      action: "SESSION_IMPORTED",
      entityType: "WORKSPACE_TASKS",
      entityId: workspaceId,
      metadata: { importedCount: created.length },
    });

    return ok(reply, { imported: created }, 201);
  });
}
