import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { planRevisionRequestSchema } from "@ai-harness/contracts";
import { errors, type TaskJob } from "@ai-harness/shared";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import type { EventPublisher } from "@ai-harness/agent-runtime";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

export default function registerPlanRoutes(
  app: FastifyInstance,
  events: EventPublisher,
  enqueue: (job: TaskJob) => Promise<void>,
) {
  const audit = createAuditRepository(app.prisma);

  app.get("/v1/tasks/:taskId/plans", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["plans"],
      summary: "List plans for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const plans = await app.prisma.taskPlan.findMany({
      where: { taskId },
      orderBy: { version: "desc" },
    });
    return ok(reply, plans.map(serializePlan));
  });

  /** Approve → record approver + enqueue execution continuation (worker-side runtime). */
  app.post("/v1/tasks/:taskId/plans/:planId/approve", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["plans"],
      summary: "Approve a draft plan",
      params: {
        type: "object",
        required: ["taskId", "planId"],
        properties: {
          taskId: { type: "string", format: "uuid" },
          planId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const planId = reqParam(req, "planId");
    const ctx = await loadTaskScoped(app, req, taskId);
    if (ctx.task.state !== "WAITING_FOR_APPROVAL") {
      throw errors.conflict(`Cannot approve a plan while task is ${ctx.task.state}`);
    }
    const plan = await app.prisma.taskPlan.findFirst({ where: { id: planId, taskId } });
    if (!plan) throw errors.notFound("Plan");
    if (plan.status !== "DRAFT") throw errors.conflict(`Plan is ${plan.status}`);

    const approved = await app.prisma.taskPlan.update({
      where: { id: planId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: req.user!.sub },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: ctx.task.workspaceId,
      action: "PLAN_APPROVED",
      entityType: "TASK_PLAN",
      entityId: planId,
      metadata: { version: plan.version },
    });
    try {
      await enqueue({ kind: "resume-approved-plan", taskId, userId: req.user!.sub, planId });
    } catch (err) {
      req.log.error({ err }, "[Plans] Failed to enqueue approved plan:");
      // Approval persisted; scheduling can be retried by the sweeper.
      throw errors.internal("Approval recorded but execution scheduling failed; retry approval");
    }
    return ok(reply, serializePlan(approved));
  });

  /** Reject → plan REJECTED and the task ends CANCELLED (machine has no FAILED edge here). */
  app.post("/v1/tasks/:taskId/plans/:planId/reject", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["plans"],
      summary: "Reject a plan and cancel the task",
      params: {
        type: "object",
        required: ["taskId", "planId"],
        properties: {
          taskId: { type: "string", format: "uuid" },
          planId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const planId = reqParam(req, "planId");
    const ctx = await loadTaskScoped(app, req, taskId);
    if (ctx.task.state !== "WAITING_FOR_APPROVAL") {
      throw errors.conflict(`Cannot reject a plan while task is ${ctx.task.state}`);
    }
    const plan = await app.prisma.taskPlan.findFirst({ where: { id: planId, taskId } });
    if (!plan) throw errors.notFound("Plan");

    await app.prisma.$transaction(async (tx) => {
      await tx.taskPlan.update({ where: { id: planId }, data: { status: "REJECTED" } });
      await tx.task.update({
        where: { id: taskId },
        data: { state: "CANCELLED", completedAt: new Date() },
      });
      const run = await tx.taskRun.findFirst({
        where: { taskId, state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
        orderBy: { runNumber: "desc" },
      });
      if (run) {
        await tx.taskRun.update({
          where: { id: run.id },
          data: { state: "CANCELLED", endedAt: new Date() },
        });
      }
    });

    const runRow = await app.prisma.taskRun.findFirst({
      where: { taskId }, orderBy: { runNumber: "desc" },
    });
    await Promise.all([
      events.publishAndEmit({
        taskId,
        runId: runRow?.id ?? null,
        eventType: TASK_EVENT_TYPES.PLAN_REJECTED,
        actorType: "USER",
        payload: { planId, rejectedBy: req.user!.sub },
      }),
      audit.record({
        actorUserId: req.user!.sub,
        workspaceId: ctx.task.workspaceId,
        action: "PLAN_REJECTED",
        entityType: "TASK_PLAN",
        entityId: planId,
      }),
    ]);
    return ok(reply, { success: true, taskState: "CANCELLED" });
  });

  /** Revision instruction rides through the queue to the worker (APP_FLOW §7). */
  app.post("/v1/tasks/:taskId/plans/:planId/revise", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["plans"],
      summary: "Request a plan revision",
      params: {
        type: "object",
        required: ["taskId", "planId"],
        properties: {
          taskId: { type: "string", format: "uuid" },
          planId: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        required: ["instruction"],
        properties: {
          instruction: { type: "string", minLength: 1, maxLength: 10000 },
        },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const planId = reqParam(req, "planId");
    const ctx = await loadTaskScoped(app, req, taskId);
    if (ctx.task.state !== "WAITING_FOR_APPROVAL") {
      throw errors.conflict(`Cannot request revision while task is ${ctx.task.state}`);
    }
    const plan = await app.prisma.taskPlan.findFirst({ where: { id: planId, taskId } });
    if (!plan || plan.status !== "DRAFT") throw errors.notFound("Pending plan");
    const input = planRevisionRequestSchema.parse(req.body);

    const runRow = await app.prisma.taskRun.findFirst({
      where: { taskId, state: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } },
      orderBy: { runNumber: "desc" },
    });
    if (!runRow) throw errors.conflict("No active run to revise");
    await events.publishAndEmit({
      taskId,
      runId: runRow.id,
      eventType: TASK_EVENT_TYPES.PLAN_REVISION_REQUESTED,
      actorType: "USER",
      payload: { planId, instruction: input.instruction, requestedBy: req.user!.sub },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: ctx.task.workspaceId,
      action: "PLAN_REVISION_REQUESTED",
      entityType: "TASK_PLAN",
      entityId: planId,
    });

    try {
      await enqueue({ kind: "revise-plan", taskId, userId: req.user!.sub, instruction: input.instruction, requestId: randomUUID() });
    } catch (err) {
      req.log.error({ err }, "[Plans] Failed to enqueue plan revision:");
      throw errors.internal("Revision recorded but scheduling failed; retry");
    }
    return ok(reply, { success: true });
  });
}

async function loadTaskScoped(
  app: FastifyInstance,
  req: Parameters<FastifyInstance["authenticate"]>[0],
  taskId: string,
) {
  const task = await app.prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw errors.notFound("Task");
  const role = await app.requireWorkspaceRole(req, task.workspaceId, "MEMBER");
  return { task, role: role.role };
}

function serializePlan(p: {
  id: string;
  taskId: string;
  runId: string;
  version: number;
  analysis: string;
  affectedFiles: unknown;
  steps: unknown;
  risks: unknown;
  verificationPlan: unknown;
  status: string;
  createdAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
}) {
  return {
    id: p.id,
    taskId: p.taskId,
    runId: p.runId,
    version: p.version,
    analysis: p.analysis,
    affectedFiles: p.affectedFiles ?? [],
    steps: p.steps ?? [],
    risks: p.risks ?? [],
    verificationPlan: p.verificationPlan ?? [],
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    approvedAt: p.approvedAt?.toISOString() ?? null,
    approvedBy: p.approvedBy,
  };
}
