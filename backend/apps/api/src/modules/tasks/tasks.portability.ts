import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  exportSessionRequestSchema,
  importSessionRequestSchema,
  cloneSessionRequestSchema,
  forkSessionRequestSchema,
  shareSessionRequestSchema,
  transferSessionRequestSchema,
  type SessionExportPackage,
} from "@ai-harness/contracts";
import { errors } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

/**
 * Session portability API: export, import, clone, fork, share, transfer tasks.
 * Tasks ARE sessions in this architecture.
 */
export function registerSessionPortabilityRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  // ─── Export session as portable JSON package ───
  app.post("/v1/tasks/:taskId/export", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");

    const input = exportSessionRequestSchema.parse(req.body ?? {});

    const [events, plans, toolCalls, checkpoints, contextPackages] = await Promise.all([
      input.includeHistory
        ? app.prisma.taskEvent.findMany({ where: { taskId }, orderBy: { sequenceNumber: "asc" } })
        : [],
      input.includePlans
        ? app.prisma.taskPlan.findMany({ where: { taskId }, orderBy: { version: "asc" } })
        : [],
      input.includeToolCalls
        ? app.prisma.toolCall.findMany({ where: { taskId }, orderBy: { startedAt: "asc" } })
        : [],
      input.includeCheckpoints
        ? app.prisma.checkpoint.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } })
        : [],
      input.includeContextPackages
        ? app.prisma.contextPackage.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } })
        : [],
    ]);

    const pkg: SessionExportPackage = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      source: {
        taskId: task.id,
        goal: task.goal,
        constraints: task.constraints,
        agentMode: task.agentMode,
        selectedModelMode: task.selectedModelMode,
        state: task.state,
        createdAt: task.createdAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
      },
      history: events.map((e) => ({
        eventType: e.eventType,
        actorType: e.actorType,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
      plans: plans.map((p) => ({
        version: p.version,
        analysis: p.analysis,
        affectedFiles: p.affectedFiles as string[],
        steps: (p.steps as Array<{ title: string; detail?: string; toolName?: string }>),
        risks: p.risks as string[],
        verificationPlan: (p.verificationPlan as Array<{ command: string }>),
        status: p.status,
      })),
      toolCalls: toolCalls.map((tc) => ({
        toolName: tc.toolName,
        riskLevel: tc.riskLevel,
        inputSummary: tc.inputSummary,
        resultSummary: tc.resultSummary,
        status: tc.status,
      })),
      checkpoints: checkpoints.map((c) => ({
        checkpointType: c.checkpointType,
        stateReference: c.stateReference,
        createdAt: c.createdAt.toISOString(),
      })),
      contextPackages: contextPackages.map((cp) => ({
        stage: cp.stage,
        manifest: cp.manifest,
        estimatedTokens: cp.estimatedTokens,
      })),
      metadata: {
        originalWorkspaceId: task.workspaceId,
        originalProjectId: task.projectId,
        exportedBy: req.user!.sub,
        hasSecrets: false,
      },
    };

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: task.workspaceId,
      action: "SESSION_EXPORTED",
      entityType: "TASK",
      entityId: taskId,
    });

    return ok(reply, { package: pkg });
  });

  // ─── Import session from portable JSON package ───
  app.post("/v1/tasks/import", { preHandler: [app.authenticate] }, async (req, reply) => {
    const input = importSessionRequestSchema.parse(req.body);
    const userId = req.user!.sub;

    const targetWorkspace = await app.prisma.workspace.findUnique({ where: { id: input.targetWorkspaceId } });
    if (!targetWorkspace) throw errors.notFound("Target workspace");
    await app.requireWorkspaceRole(req, input.targetWorkspaceId, "MEMBER");

    const targetProject = await app.prisma.project.findFirst({
      where: { id: input.targetProjectId, workspaceId: input.targetWorkspaceId },
    });
    if (!targetProject) throw errors.notFound("Target project");

    const pkg = input.packageJson as unknown as SessionExportPackage;
    if (pkg.version !== "1.0" || !pkg.source) {
      throw errors.validation("Invalid session package format");
    }

    const newTask = await app.prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: input.targetWorkspaceId,
        projectId: input.targetProjectId,
        createdBy: userId,
        goal: `[Imported] ${pkg.source.goal}`,
        constraints: pkg.source.constraints,
        state: "QUEUED",
        agentMode: (pkg.source.agentMode as "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX") ?? "BUILD",
        selectedModelMode: (pkg.source.selectedModelMode as "MANUAL" | "ROUTED") ?? "ROUTED",
      },
    });

    // Import events
    if (pkg.history.length > 0) {
      await app.prisma.taskEvent.createMany({
        data: pkg.history.map((e, i) => ({
          id: randomUUID(),
          taskId: newTask.id,
          sequenceNumber: BigInt(i + 1),
          eventType: e.eventType,
          actorType: (e.actorType as "USER" | "AGENT" | "SYSTEM") ?? "SYSTEM",
          payload: e.payload as unknown as Record<string, string>,
        })),
      });
    }

    // Import plans
    if (pkg.plans.length > 0) {
      const run = await app.prisma.taskRun.create({
        data: { id: randomUUID(), taskId: newTask.id, runNumber: 1, state: "QUEUED" },
      });
      await app.prisma.taskPlan.createMany({
        data: pkg.plans.map((p) => ({
          id: randomUUID(),
          taskId: newTask.id,
          runId: run.id,
          version: p.version,
          analysis: p.analysis,
          affectedFiles: p.affectedFiles as unknown as string[],
          steps: p.steps as unknown as string[],
          risks: p.risks as unknown as string[],
          verificationPlan: p.verificationPlan as unknown as string[],
          status: "DRAFT" as const,
        })),
      });
    }

    await audit.record({
      actorUserId: userId,
      workspaceId: input.targetWorkspaceId,
      action: "SESSION_IMPORTED",
      entityType: "TASK",
      entityId: newTask.id,
      metadata: { sourceTaskId: pkg.source.taskId },
    });

    return ok(reply, { id: newTask.id, goal: newTask.goal }, 201);
  });

  // ─── Clone session within same workspace ───
  app.post("/v1/tasks/:taskId/clone", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    const input = cloneSessionRequestSchema.parse(req.body ?? {});
    const userId = req.user!.sub;

    const newTask = await app.prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        createdBy: userId,
        goal: input.goal ?? `[Clone] ${task.goal}`,
        constraints: task.constraints,
        state: "QUEUED",
        agentMode: task.agentMode,
        selectedModelMode: task.selectedModelMode,
        overrideProviderConnectionId: task.overrideProviderConnectionId,
        overrideModelIdentifier: task.overrideModelIdentifier,
        parentTaskId: task.id,
      },
    });

    await audit.record({
      actorUserId: userId,
      workspaceId: task.workspaceId,
      action: "SESSION_CLONED",
      entityType: "TASK",
      entityId: newTask.id,
      metadata: { sourceTaskId: task.id },
    });

    return ok(reply, { id: newTask.id, goal: newTask.goal }, 201);
  });

  // ─── Fork session (optionally into another workspace) ───
  app.post("/v1/tasks/:taskId/fork", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "VIEWER");

    const input = forkSessionRequestSchema.parse(req.body);
    const userId = req.user!.sub;

    const targetWorkspaceId = input.targetWorkspaceId ?? task.workspaceId;
    const targetProjectId = input.targetProjectId ?? task.projectId;

    if (targetWorkspaceId !== task.workspaceId) {
      await app.requireWorkspaceRole(req, targetWorkspaceId, "MEMBER");
    }

    const targetProject = await app.prisma.project.findFirst({
      where: { id: targetProjectId, workspaceId: targetWorkspaceId },
    });
    if (!targetProject) throw errors.notFound("Target project");

    const newTask = await app.prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: targetWorkspaceId,
        projectId: targetProjectId,
        createdBy: userId,
        goal: input.goal,
        constraints: task.constraints,
        state: "QUEUED",
        agentMode: task.agentMode,
        selectedModelMode: task.selectedModelMode,
        parentTaskId: task.id,
      },
    });

    // Copy plans from source
    const sourcePlans = await app.prisma.taskPlan.findMany({ where: { taskId } });
    if (sourcePlans.length > 0) {
      const run = await app.prisma.taskRun.create({
        data: { id: randomUUID(), taskId: newTask.id, runNumber: 1, state: "QUEUED" },
      });
      await app.prisma.taskPlan.createMany({
        data: sourcePlans.map((p) => ({
          id: randomUUID(),
          taskId: newTask.id,
          runId: run.id,
          version: p.version,
          analysis: p.analysis,
          affectedFiles: p.affectedFiles as unknown as string[],
          steps: p.steps as unknown as string[],
          risks: p.risks as unknown as string[],
          verificationPlan: p.verificationPlan as unknown as string[],
          status: "DRAFT" as const,
        })),
      });
    }

    await audit.record({
      actorUserId: userId,
      workspaceId: targetWorkspaceId,
      action: "SESSION_FORKED",
      entityType: "TASK",
      entityId: newTask.id,
      metadata: { sourceTaskId: task.id, sourceWorkspaceId: task.workspaceId },
    });

    return ok(reply, { id: newTask.id, goal: newTask.goal }, 201);
  });

  // ─── Generate share link ───
  app.post("/v1/tasks/:taskId/share", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");

    const input = shareSessionRequestSchema.parse(req.body ?? {});
    const userId = req.user!.sub;

    const token = randomUUID().replace(/-/g, "");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const expiresAt = input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
      : null;

    await app.prisma.sessionShare.create({
      data: {
        id: randomUUID(),
        taskId,
        sharedBy: userId,
        tokenHash,
        permission: input.permission,
        expiresAt,
      },
    });

    await audit.record({
      actorUserId: userId,
      workspaceId: task.workspaceId,
      action: "SESSION_SHARED",
      entityType: "TASK",
      entityId: taskId,
      metadata: { permission: input.permission },
    });

    return ok(reply, {
      token,
      permission: input.permission,
      expiresAt: expiresAt?.toISOString() ?? null,
      url: `/shared/${token}`,
    });
  });

  // ─── Access shared session via token ───
  app.get("/v1/tasks/share/:token", async (req, reply) => {
    const token = reqParam(req, "token");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const share = await app.prisma.sessionShare.findUnique({
      where: { tokenHash },
      include: { task: true },
    });
    if (!share) throw errors.notFound("Share link");
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw errors.validation("Share link has expired");
    }

    const task = share.task;

    return ok(reply, {
      taskId: task.id,
      goal: task.goal,
      state: task.state,
      agentMode: task.agentMode,
      permission: share.permission,
      createdAt: task.createdAt.toISOString(),
    });
  });

  // ─── Transfer session to another workspace ───
  app.post("/v1/tasks/:taskId/transfer", { preHandler: [app.authenticate] }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const task = await app.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw errors.notFound("Task");
    await app.requireWorkspaceRole(req, task.workspaceId, "OWNER");

    const input = transferSessionRequestSchema.parse(req.body);
    const userId = req.user!.sub;

    await app.requireWorkspaceRole(req, input.targetWorkspaceId, "MEMBER");

    const targetProject = await app.prisma.project.findFirst({
      where: { id: input.targetProjectId, workspaceId: input.targetWorkspaceId },
    });
    if (!targetProject) throw errors.notFound("Target project");

    const updated = await app.prisma.task.update({
      where: { id: taskId },
      data: {
        workspaceId: input.targetWorkspaceId,
        projectId: input.targetProjectId,
      },
    });

    await audit.record({
      actorUserId: userId,
      workspaceId: input.targetWorkspaceId,
      action: "SESSION_TRANSFERRED",
      entityType: "TASK",
      entityId: taskId,
      metadata: { fromWorkspaceId: task.workspaceId },
    });

    return ok(reply, { id: updated.id, workspaceId: updated.workspaceId });
  });
}
