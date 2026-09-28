import type { FastifyInstance } from "fastify";
import { taskEventsQuerySchema } from "@ai-harness/contracts";
import { AppError, errors, getEnv, BridgeGatewayClient } from "@ai-harness/shared";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import { ok, reqParam } from "../../lib/http.js";

export default function registerActivityRoutes(
  app: FastifyInstance,
  events: import("@ai-harness/agent-runtime").EventPublisher,
  audit: ReturnType<typeof import("@ai-harness/database").createAuditRepository>,
) {
  app.get("/v1/tasks/:taskId/events", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "List events for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const query = taskEventsQuerySchema.parse(req.query ?? {});
    const rows = await app.prisma.taskEvent.findMany({
      where: {
        taskId,
        ...(query.afterSequence !== undefined
          ? { sequenceNumber: { gt: BigInt(query.afterSequence) } }
          : {}),
      },
      orderBy: { sequenceNumber: "asc" },
      take: query.limit,
    });
    return ok(
      reply,
      rows.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        runId: e.runId,
        sequenceNumber: Number(e.sequenceNumber),
        eventType: e.eventType,
        actorType: e.actorType,
        payload: e.payload ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    );
  });

  app.get("/v1/tasks/:taskId/context", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "List context packages for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const packages = await app.prisma.contextPackage.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      reply,
      packages.map((p) => ({
        id: p.id,
        taskId: p.taskId,
        runId: p.runId,
        stage: p.stage,
        manifest: p.manifest,
        estimatedTokens: p.estimatedTokens,
        createdAt: p.createdAt.toISOString(),
      })),
    );
  });

  app.get("/v1/tasks/:taskId/context/:contextPackageId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "Get a specific context package",
      params: {
        type: "object",
        required: ["taskId", "contextPackageId"],
        properties: {
          taskId: { type: "string", format: "uuid" },
          contextPackageId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const contextPackageId = reqParam(req, "contextPackageId");
    await loadTaskScoped(app, req, taskId);
    const pkg = await app.prisma.contextPackage.findFirst({
      where: { id: contextPackageId, taskId },
    });
    if (!pkg) throw errors.notFound("Context package");
    return ok(reply, {
      id: pkg.id,
      taskId: pkg.taskId,
      runId: pkg.runId,
      stage: pkg.stage,
      manifest: pkg.manifest,
      estimatedTokens: pkg.estimatedTokens,
      createdAt: pkg.createdAt.toISOString(),
    });
  });

  app.get("/v1/tasks/:taskId/changes", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "List tool calls (file changes) for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const calls = await app.prisma.toolCall.findMany({
      where: { taskId },
      orderBy: { startedAt: "asc" },
    });
    return ok(
      reply,
      calls.map((c) => ({
        id: c.id,
        taskId: c.taskId,
        runId: c.runId,
        toolName: c.toolName,
        riskLevel: c.riskLevel,
        inputSummary: c.inputSummary,
        status: c.status,
        resultSummary: c.resultSummary,
        startedAt: c.startedAt?.toISOString() ?? null,
        completedAt: c.completedAt?.toISOString() ?? null,
      })),
    );
  });

  app.get("/v1/tasks/:taskId/checkpoints", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "List checkpoints for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const checkpoints = await app.prisma.checkpoint.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      reply,
      checkpoints.map((c) => ({
        id: c.id,
        taskId: c.taskId,
        projectId: c.projectId,
        checkpointType: c.checkpointType,
        stateReference: c.stateReference,
        createdBy: c.createdBy,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  });

  /**
   * Rollback requires explicit confirmation and a connected bridge owning the
   * project root (PRD F-14). Failures are structured — never fake success.
   */
  app.post("/v1/checkpoints/:checkpointId/rollback", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "Rollback to a checkpoint",
      params: {
        type: "object",
        required: ["checkpointId"],
        properties: { checkpointId: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["confirm"],
        properties: {
          confirm: { type: "boolean", enum: [true] },
        },
      },
    },
  }, async (req, reply) => {
    const checkpointId = reqParam(req, "checkpointId");
    const body = (req.body ?? {}) as { confirm?: boolean };
    if (body.confirm !== true) {
      throw errors.validation("Rollback overwrites current changes; send { confirm: true }");
    }
    const checkpoint = await app.prisma.checkpoint.findUnique({
      where: { id: checkpointId },
      include: { project: { include: { bridge: true } } },
    });
    if (!checkpoint) throw errors.notFound("Checkpoint");
    await loadTaskScoped(app, req, checkpoint.taskId, "MEMBER");

    const ref = checkpoint.stateReference as { kind?: string; ref?: string };
    if (ref.kind !== "git" || !ref.ref) {
      throw errors.conflict("This checkpoint has no executable state reference");
    }
    if (!checkpoint.project.bridge || checkpoint.project.bridge.status !== "CONNECTED") {
      throw errors.bridgeDisconnected("The Local Bridge that owns this root is not connected");
    }

    const env = getEnv();
    const gateway = new BridgeGatewayClient({ baseUrl: env.BRIDGE_GATEWAY_URL, internalToken: env.BRIDGE_INTERNAL_TOKEN });
    const response = await gateway.execute(
      checkpoint.project.bridge.id,
      "ckpt.rollback",
      { root: checkpoint.project.rootReference, ref: ref.ref },
      120_000,
    );
    if (!response.ok) {
      throw new AppError(
        (response.error?.code as never) ?? "INTERNAL_ERROR",
        response.error?.message ?? "Rollback failed",
      );
    }

    await Promise.all([
      audit.record({
        actorUserId: req.user!.sub,
        workspaceId: checkpoint.project.workspaceId,
        action: "CHECKPOINT_ROLLED_BACK",
        entityType: "CHECKPOINT",
        entityId: checkpoint.id,
        metadata: { taskId: checkpoint.taskId, resetTo: ref.ref },
      }),
      events.publishAndEmit({
        taskId: checkpoint.taskId,
        runId: null,
        eventType: TASK_EVENT_TYPES.STATE_CHANGED,
        actorType: "USER",
        payload: { note: "CHECKPOINT_ROLLED_BACK", checkpointId, resetTo: ref.ref },
      }),
    ]);
    return ok(reply, { rolledBackTo: ref.ref });
  });

  app.get("/v1/tasks/:taskId/verification", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "List verification results for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const results = await app.prisma.verificationResult.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });
    return ok(
      reply,
      results.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        runId: r.runId,
        command: r.command,
        status: r.status,
        outputReference: r.outputReference,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  });

  app.get("/v1/tasks/:taskId/approvals", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["activity"],
      summary: "List approval requests for a task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    await loadTaskScoped(app, req, taskId);
    const approvals = await app.prisma.approvalRequest.findMany({
      where: { taskId },
      include: { toolCall: true },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      reply,
      approvals.map((a) => ({
        id: a.id,
        taskId: a.taskId,
        toolCallId: a.toolCallId,
        requestedScope: a.requestedScope,
        status: a.status,
        requestedByActor: a.requestedByActor,
        expiresAt: a.expiresAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
        decidedAt: a.decidedAt?.toISOString() ?? null,
        toolCall: a.toolCall
          ? {
              id: a.toolCall.id,
              toolName: a.toolCall.toolName,
              riskLevel: a.toolCall.riskLevel,
              inputSummary: a.toolCall.inputSummary,
              status: a.toolCall.status,
            }
          : undefined,
      })),
    );
  });
}

async function loadTaskScoped(
  app: import("fastify").FastifyInstance,
  req: Parameters<import("fastify").FastifyInstance["authenticate"]>[0],
  taskId: string,
  minimum: "OWNER" | "MEMBER" | "VIEWER" = "VIEWER",
) {
  const task = await app.prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw errors.notFound("Task");
  const role = await app.requireWorkspaceRole(req, task.workspaceId, minimum);
  return { task, role: role.role };
}
