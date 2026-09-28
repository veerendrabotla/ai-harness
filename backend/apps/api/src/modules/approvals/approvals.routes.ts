import type { FastifyInstance, FastifyReply } from "fastify";
import type { FastifyRequest } from "fastify";
import { errors, type TaskJob } from "@ai-harness/shared";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import type { EventPublisher } from "@ai-harness/agent-runtime";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

/**
 * Approval decisions (PRD F-11).
 * - 120 requests / minute / user rate limit (BACKEND_STRUCTURE §7)
 * - Decisions are audited; agents can never call these (JWT user identity required)
 */
export default function registerApprovalRoutes(
  app: FastifyInstance,
  events: EventPublisher,
  enqueue: (job: TaskJob) => Promise<void>,
) {
  const audit = createAuditRepository(app.prisma);

  const decide = (approved: boolean) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const approvalId = reqParam(req, "approvalId");
      const userId = req.user!.sub;

      const approval = await app.prisma.approvalRequest.findUnique({
        where: { id: approvalId },
        include: { task: true },
      });
      if (!approval) throw errors.notFound("Approval request");
      await app.requireWorkspaceRole(req, approval.task.workspaceId, "MEMBER");

      if (approval.status === "EXPIRED") throw errors.approvalExpired();
      if (approval.status !== "PENDING") {
        throw errors.conflict(`Approval already resolved (${approval.status})`);
      }
      if (approval.expiresAt.getTime() < Date.now()) {
        await app.prisma.$transaction(async (tx) => {
          await tx.approvalRequest.update({
            where: { id: approval.id },
            data: { status: "EXPIRED" },
          });
          if (approval.toolCallId) {
            await tx.toolCall.updateMany({
              where: { id: approval.toolCallId, status: "WAITING_APPROVAL" },
              data: { status: "DENIED" },
            });
          }
        });
        await events.publishAndEmit({
          taskId: approval.taskId,
          runId: null,
          eventType: TASK_EVENT_TYPES.APPROVAL_EXPIRED,
          actorType: "SYSTEM",
          payload: { approvalId },
        });
        throw errors.approvalExpired();
      }

      await app.prisma.$transaction(async (tx) => {
        // Race-safe claim: only the first decision mutates the PENDING row.
        const claimed = await tx.approvalRequest.updateMany({
          where: { id: approval.id, status: "PENDING" },
          data: {
            status: approved ? "APPROVED" : "DENIED",
            decidedBy: userId,
            decidedAt: new Date(),
          },
        });
        if (claimed.count === 0) throw errors.conflict("Approval already resolved");
        if (approval.toolCallId) {
          await tx.toolCall.update({
            where: { id: approval.toolCallId },
            data: { status: approved ? "PENDING" : "DENIED" },
          });
        }
      });

      await Promise.all([
        events.publishAndEmit({
          taskId: approval.taskId,
          runId: null,
          eventType: approved ? TASK_EVENT_TYPES.TOOL_APPROVED : TASK_EVENT_TYPES.TOOL_DENIED,
          actorType: "USER",
          payload: { approvalId, toolCallId: approval.toolCallId, decidedBy: userId },
        }),
        audit.record({
          actorUserId: userId,
          workspaceId: approval.task.workspaceId,
          action: approved ? "APPROVAL_GRANTED" : "APPROVAL_DENIED",
          entityType: "APPROVAL_REQUEST",
          entityId: approval.id,
          metadata: { taskId: approval.taskId },
        }),
      ]);

      try {
        // Both branches continue the run; the runtime applies the decision
        // (execute the tool vs. record denial + replan).
        await enqueue({ kind: "continue-after-tool-decision", taskId: approval.taskId, approvalId: approval.id });
      } catch (err) {
        req.log.error({ err }, "failed to enqueue continuation after approval");
        throw errors.internal("Decision recorded but scheduling failed");
      }

      return ok(reply, { id: approval.id, status: approved ? "APPROVED" : "DENIED" });
    };

  app.post(
    "/v1/approvals/:approvalId/approve",
    {
      preHandler: [app.authenticate],
      config: {
        rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: (r) => r.user?.sub ?? r.ip },
      },
      schema: {
        tags: ["approvals"],
        summary: "Approve a pending approval request",
        params: {
          type: "object",
          required: ["approvalId"],
          properties: { approvalId: { type: "string", format: "uuid" } },
        },
      },
    },
    decide(true),
  );

  app.post(
    "/v1/approvals/:approvalId/deny",
    {
      preHandler: [app.authenticate],
      config: {
        rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: (r) => r.user?.sub ?? r.ip },
      },
      schema: {
        tags: ["approvals"],
        summary: "Deny a pending approval request",
        params: {
          type: "object",
          required: ["approvalId"],
          properties: { approvalId: { type: "string", format: "uuid" } },
        },
      },
    },
    decide(false),
  );
}
