/**
 * Cost Alert Routes.
 * Manage workspace-level cost alerts.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";
import { sendCostAlertNotifications } from "../../lib/cost-alert-notifications.js";

export default function registerCostAlertRoutes(app: FastifyInstance) {
  /**
   * List cost alerts for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/cost-alerts", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["cost-alerts"],
      summary: "List cost alerts",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const alerts = await app.prisma.costAlert.findMany({
      where: { workspaceId },
      select: {
        id: true,
        thresholdType: true,
        thresholdValue: true,
        period: true,
        enabled: true,
        lastTriggered: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, alerts);
  });

  /**
   * Create a cost alert.
   */
  app.post<{
    Params: { workspaceId: string };
    Body: { thresholdType: string; thresholdValue: number; period: string };
  }>("/v1/workspaces/:workspaceId/cost-alerts", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["cost-alerts"],
      summary: "Create a cost alert",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["thresholdType", "thresholdValue", "period"],
        properties: {
          thresholdType: { type: "string", enum: ["COST", "TOKENS"] },
          thresholdValue: { type: "number", minimum: 0 },
          period: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY"] },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { thresholdType, thresholdValue, period } = req.body as {
      thresholdType: string;
      thresholdValue: number;
      period: string;
    };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const alert = await app.prisma.costAlert.create({
      data: {
        workspaceId,
        thresholdType,
        thresholdValue,
        period,
      },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "COST_ALERT_CREATED",
      alertId: alert.id,
      thresholdType,
      thresholdValue,
      period,
    });

    return ok(reply, alert, 201);
  });

  /**
   * Update a cost alert.
   */
  app.put<{
    Params: { workspaceId: string; alertId: string };
    Body: { thresholdValue?: number; enabled?: boolean };
  }>("/v1/workspaces/:workspaceId/cost-alerts/:alertId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["cost-alerts"],
      summary: "Update a cost alert",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const alertId = (req.params as { alertId: string }).alertId;
    const { thresholdValue, enabled } = req.body as { thresholdValue?: number; enabled?: boolean };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const alert = await app.prisma.costAlert.findUnique({
      where: { id: alertId, workspaceId },
    });
    if (!alert) throw errors.notFound("Cost alert");

    const updated = await app.prisma.costAlert.update({
      where: { id: alertId },
      data: {
        ...(thresholdValue !== undefined && { thresholdValue }),
        ...(enabled !== undefined && { enabled }),
      },
    });

    return ok(reply, updated);
  });

  /**
   * Delete a cost alert.
   */
  app.delete<{
    Params: { workspaceId: string; alertId: string };
  }>("/v1/workspaces/:workspaceId/cost-alerts/:alertId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["cost-alerts"],
      summary: "Delete a cost alert",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const alertId = (req.params as { alertId: string }).alertId;

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    await app.prisma.costAlert.delete({
      where: { id: alertId, workspaceId },
    });

    return ok(reply, { success: true });
  });

  /**
   * Check cost alerts (called by worker/scheduler).
   */
  app.post("/v1/cost-alerts/check", {
    preHandler: [app.authenticate, app.requirePlatformAdmin],
    schema: {
      tags: ["cost-alerts"],
      summary: "Check and trigger cost alerts",
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    const now = new Date();
    const alerts = await app.prisma.costAlert.findMany({
      where: { enabled: true },
    });

    let triggered = 0;
    for (const alert of alerts) {
      // Check if alert was already triggered this period
      if (alert.lastTriggered) {
        const lastTriggered = new Date(alert.lastTriggered);
        const periodMs = alert.period === "DAILY" ? 86400000
          : alert.period === "WEEKLY" ? 604800000
          : 2592000000; // Monthly
        if (now.getTime() - lastTriggered.getTime() < periodMs) continue;
      }

      // Get usage for the period
      const periodStart = new Date(now);
      if (alert.period === "DAILY") periodStart.setDate(periodStart.getDate() - 1);
      else if (alert.period === "WEEKLY") periodStart.setDate(periodStart.getDate() - 7);
      else periodStart.setMonth(periodStart.getMonth() - 1);

      const usage = await app.prisma.usageRecord.aggregate({
        where: {
          workspaceId: alert.workspaceId,
          createdAt: { gte: periodStart },
        },
        _sum: {
          estimatedCost: alert.thresholdType === "COST" ? true : undefined,
          totalTokens: alert.thresholdType === "TOKENS" ? true : undefined,
        },
      });

      const currentValue = alert.thresholdType === "COST"
        ? (usage._sum.estimatedCost ?? 0)
        : (usage._sum.totalTokens ?? 0);

      if (currentValue >= alert.thresholdValue) {
        await app.prisma.costAlert.update({
          where: { id: alert.id },
          data: { lastTriggered: now },
        });
        triggered++;
        // Send notifications asynchronously
        void sendCostAlertNotifications(app.prisma, {
          workspaceId: alert.workspaceId,
          alertId: alert.id,
          thresholdType: alert.thresholdType,
          thresholdValue: alert.thresholdValue,
          period: alert.period,
          currentValue,
        }).catch(() => { /* notification failure is non-fatal */ });
      }
    }

    return ok(reply, { checked: alerts.length, triggered });
  });
}
