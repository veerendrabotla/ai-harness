import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { saveInstructionsRequestSchema, policyUpdateRequestSchema } from "@ai-harness/contracts";
import { errors } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

export default function registerInstructionPolicyRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  // ── Instructions ─────────────────────────────────────────

  app.get("/v1/workspaces/:workspaceId/instructions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["instructions"],
      summary: "List instruction versions for a workspace",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");
    const versions = await app.prisma.workspaceInstructionVersion.findMany({
      where: { workspaceId },
      orderBy: { version: "desc" },
      take: 50,
    });
    return ok(
      reply,
      versions.map((v) => ({
        id: v.id,
        version: v.version,
        content: v.content,
        createdBy: v.createdBy,
        createdAt: v.createdAt.toISOString(),
      })),
    );
  });

  app.post("/v1/workspaces/:workspaceId/instructions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["instructions"],
      summary: "Create a new instruction version",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const input = saveInstructionsRequestSchema.parse(req.body);
    const max = await app.prisma.workspaceInstructionVersion.aggregate({
      where: { workspaceId },
      _max: { version: true },
    });
    const version = (max._max.version ?? 0) + 1;
    const created = await app.prisma.workspaceInstructionVersion.create({
      data: {
        id: randomUUID(),
        workspaceId,
        version,
        content: input.content,
        createdBy: req.user!.sub,
      },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "INSTRUCTIONS_UPDATED",
      entityType: "WORKSPACE_INSTRUCTIONS",
      entityId: created.id,
      metadata: { version },
    });
    return ok(
      reply,
      { id: created.id, version: created.version, createdAt: created.createdAt.toISOString() },
      201,
    );
  });

  // ── Policy ───────────────────────────────────────────────

  app.get("/v1/workspaces/:workspaceId/policy", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["policy"],
      summary: "Get workspace policy with tool rules",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");
    const policy = await app.prisma.workspacePolicy.findUnique({
      where: { workspaceId },
      include: { toolRules: true },
    });
    if (!policy) throw errors.notFound("Workspace policy");
    return ok(reply, serializePolicyWithRules(policy));
  });

  /** PUT replaces policy fields and the full tool-rule set; every change is audited (F-02). */
  app.put("/v1/workspaces/:workspaceId/policy", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["policy"],
      summary: "Replace workspace policy and tool rules",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");
    const input = policyUpdateRequestSchema.parse(req.body);

    const updated = await app.prisma.$transaction(async (tx) => {
      const policy = await tx.workspacePolicy.update({
        where: { workspaceId },
        data: {
          ...(input.requirePlanApproval !== undefined ? { requirePlanApproval: input.requirePlanApproval } : {}),
          ...(input.allowDirectExecution !== undefined ? { allowDirectExecution: input.allowDirectExecution } : {}),
          ...(input.maxTaskDurationSeconds !== undefined ? { maxTaskDurationSeconds: input.maxTaskDurationSeconds } : {}),
          ...(input.maxToolCallsPerRun !== undefined ? { maxToolCallsPerRun: input.maxToolCallsPerRun } : {}),
          ...(input.maxSubagents !== undefined ? { maxSubagents: input.maxSubagents } : {}),
          ...(input.blockOnReviewFindings !== undefined ? { blockOnReviewFindings: input.blockOnReviewFindings } : {}),
        },
        include: { toolRules: true },
      });
      if (input.toolRules) {
        await tx.toolPolicyRule.deleteMany({ where: { workspacePolicyId: policy.id } });
        for (const rule of input.toolRules) {
          await tx.toolPolicyRule.create({
            data: {
              id: randomUUID(),
              workspacePolicyId: policy.id,
              toolName: rule.toolName,
              actionPattern: rule.actionPattern ?? null,
              riskLevel: rule.riskLevel,
              decision: rule.decision,
            },
          });
        }
      }
      return tx.workspacePolicy.findUniqueOrThrow({
        where: { workspaceId },
        include: { toolRules: true },
      });
    });

    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId,
      action: "WORKSPACE_POLICY_UPDATED",
      entityType: "WORKSPACE_POLICY",
      entityId: updated.id,
      metadata: {
        fields: Object.keys(input).filter((k) => k !== "toolRules"),
        ruleCount: input.toolRules?.length,
      },
    });
    return ok(reply, serializePolicyWithRules(updated));
  });
}

interface PolicyWithRules {
  id: string;
  workspaceId: string;
  requirePlanApproval: boolean;
  allowDirectExecution: boolean;
  blockOnReviewFindings: boolean;
  maxTaskDurationSeconds: number;
  maxToolCallsPerRun: number;
  maxSubagents: number;
  updatedAt: Date;
  toolRules: Array<{
    id: string;
    toolName: string;
    actionPattern: string | null;
    riskLevel: string;
    decision: string;
  }>;
}

function serializePolicyWithRules(policy: PolicyWithRules) {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    requirePlanApproval: policy.requirePlanApproval,
    allowDirectExecution: policy.allowDirectExecution,
    blockOnReviewFindings: policy.blockOnReviewFindings,
    maxTaskDurationSeconds: policy.maxTaskDurationSeconds,
    maxToolCallsPerRun: policy.maxToolCallsPerRun,
    maxSubagents: policy.maxSubagents,
    updatedAt: policy.updatedAt.toISOString(),
    toolRules: policy.toolRules.map((r) => ({
      id: r.id,
      toolName: r.toolName,
      actionPattern: r.actionPattern,
      riskLevel: r.riskLevel,
      decision: r.decision,
    })),
  };
}
