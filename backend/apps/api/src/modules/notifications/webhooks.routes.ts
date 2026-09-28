import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

const AVAILABLE_EVENT_TYPES = [
  "task.completed",
  "task.failed",
  "deployment.ready",
  "deployment.failed",
  "approval.requested",
  "approval.decided",
  "member.joined",
  "member.removed",
  "workspace.updated",
] as const;

export default function registerWebhookRoutes(app: FastifyInstance) {
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/webhook-subscriptions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "List webhook subscriptions for a workspace",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const subscriptions = await app.prisma.webhookSubscription.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        status: true,
        maxRetries: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok(reply, subscriptions);
  });

  app.get<{
    Params: { workspaceId: string; subscriptionId: string };
  }>("/v1/workspaces/:workspaceId/webhook-subscriptions/:subscriptionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "Get a webhook subscription",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["workspaceId", "subscriptionId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          subscriptionId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, subscriptionId } = req.params as {
      workspaceId: string;
      subscriptionId: string;
    };
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const sub = await app.prisma.webhookSubscription.findFirst({
      where: { id: subscriptionId, workspaceId },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        status: true,
        maxRetries: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!sub) throw errors.notFound("Webhook subscription");
    return ok(reply, sub);
  });

  app.post<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/webhook-subscriptions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "Create a webhook subscription",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["url", "eventTypes"],
        properties: {
          url: { type: "string", format: "uri", maxLength: 2048 },
          eventTypes: {
            type: "array",
            items: { type: "string", enum: [...AVAILABLE_EVENT_TYPES] },
            minItems: 1,
          },
          secret: { type: "string", maxLength: 255 },
          maxRetries: { type: "integer", minimum: 0, maximum: 10, default: 3 },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const body = req.body as {
      url: string;
      eventTypes: string[];
      secret?: string;
      maxRetries?: number;
    };

    const subscription = await app.prisma.webhookSubscription.create({
      data: {
        workspaceId,
        url: body.url,
        eventTypes: body.eventTypes,
        secret: body.secret ?? null,
        maxRetries: body.maxRetries ?? 3,
      },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        status: true,
        maxRetries: true,
        createdAt: true,
      },
    });

    return ok(reply, subscription, 201);
  });

  app.patch<{
    Params: { workspaceId: string; subscriptionId: string };
  }>("/v1/workspaces/:workspaceId/webhook-subscriptions/:subscriptionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "Update a webhook subscription",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["workspaceId", "subscriptionId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          subscriptionId: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri", maxLength: 2048 },
          eventTypes: {
            type: "array",
            items: { type: "string", enum: [...AVAILABLE_EVENT_TYPES] },
            minItems: 1,
          },
          secret: { type: "string", maxLength: 255 },
          maxRetries: { type: "integer", minimum: 0, maximum: 10 },
          status: { type: "string", enum: ["ACTIVE", "DISABLED"] },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, subscriptionId } = req.params as {
      workspaceId: string;
      subscriptionId: string;
    };
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const body = req.body as {
      url?: string;
      eventTypes?: string[];
      secret?: string;
      maxRetries?: number;
      status?: string;
    };

    const existing = await app.prisma.webhookSubscription.findFirst({
      where: { id: subscriptionId, workspaceId },
    });
    if (!existing) throw errors.notFound("Webhook subscription");

    const subscription = await app.prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: {
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.eventTypes !== undefined ? { eventTypes: body.eventTypes } : {}),
        ...(body.secret !== undefined ? { secret: body.secret } : {}),
        ...(body.maxRetries !== undefined ? { maxRetries: body.maxRetries } : {}),
        ...(body.status !== undefined ? { status: body.status as "ACTIVE" | "DISABLED" } : {}),
      },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        status: true,
        maxRetries: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok(reply, subscription);
  });

  app.delete<{
    Params: { workspaceId: string; subscriptionId: string };
  }>("/v1/workspaces/:workspaceId/webhook-subscriptions/:subscriptionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "Delete a webhook subscription",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["workspaceId", "subscriptionId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          subscriptionId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, subscriptionId } = req.params as {
      workspaceId: string;
      subscriptionId: string;
    };
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const existing = await app.prisma.webhookSubscription.findFirst({
      where: { id: subscriptionId, workspaceId },
    });
    if (!existing) throw errors.notFound("Webhook subscription");

    await app.prisma.webhookSubscription.delete({
      where: { id: subscriptionId },
    });

    return ok(reply, { success: true });
  });

  app.get<{
    Params: { workspaceId: string; subscriptionId: string };
  }>("/v1/workspaces/:workspaceId/webhook-subscriptions/:subscriptionId/deliveries", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "List delivery logs for a webhook subscription",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["workspaceId", "subscriptionId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          subscriptionId: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["PENDING", "DELIVERED", "FAILED", "DEAD"] },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (req, reply) => {
    const { workspaceId, subscriptionId } = req.params as {
      workspaceId: string;
      subscriptionId: string;
    };
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const existing = await app.prisma.webhookSubscription.findFirst({
      where: { id: subscriptionId, workspaceId },
    });
    if (!existing) throw errors.notFound("Webhook subscription");

    const q = req.query as { status?: string; limit?: number };

    const logs = await app.prisma.webhookDeliveryLog.findMany({
      where: {
        subscriptionId,
        ...(q.status ? { status: q.status as "PENDING" | "DELIVERED" | "FAILED" | "DEAD" } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limit ?? 50,
      select: {
        id: true,
        event: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
        lastError: true,
        deliveredAt: true,
        createdAt: true,
      },
    });

    return ok(reply, logs);
  });

  app.get("/v1/webhooks/event-types", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "List available webhook event types",
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    return ok(reply, AVAILABLE_EVENT_TYPES);
  });

  /**
   * Get Slack webhook URL configuration for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/slack-webhook", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks", "slack"],
      summary: "Get Slack webhook URL for a workspace",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const workspace = await app.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { webhookUrls: true },
    });

    const slackUrl = workspace?.webhookUrls?.find((url) => url.includes("hooks.slack.com")) ?? null;
    return ok(reply, { url: slackUrl });
  });

  /**
   * Set Slack webhook URL for a workspace.
   */
  app.put<{
    Params: { workspaceId: string };
    Body: { url: string };
  }>("/v1/workspaces/:workspaceId/slack-webhook", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks", "slack"],
      summary: "Set Slack webhook URL for a workspace",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { url } = req.body as { url: string };
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    if (url && !url.includes("hooks.slack.com")) {
      throw errors.validation("URL must be a Slack incoming webhook URL");
    }

    const workspace = await app.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { webhookUrls: true },
    });

    const existing = workspace?.webhookUrls ?? [];
    const withoutSlack = existing.filter((u) => !u.includes("hooks.slack.com"));
    const updated = url ? [...withoutSlack, url] : withoutSlack;

    await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: { webhookUrls: updated },
    });

    return ok(reply, { success: true });
  });

  /**
   * Test a webhook subscription by sending a ping event.
   */
  app.post<{
    Params: { workspaceId: string; subscriptionId: string };
  }>("/v1/workspaces/:workspaceId/webhook-subscriptions/:subscriptionId/test", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webhooks"],
      summary: "Test a webhook subscription",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { workspaceId, subscriptionId } = req.params as { workspaceId: string; subscriptionId: string };

    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const subscription = await app.prisma.webhookSubscription.findFirst({
      where: { id: subscriptionId, workspaceId },
    });
    if (!subscription) throw errors.notFound("Webhook subscription");

    const testPayload = {
      event: "webhook.test",
      timestamp: new Date().toISOString(),
      data: {
        message: "This is a test webhook delivery from AI Harness",
        subscriptionId,
        workspaceId,
      },
    };

    const bodyStr = JSON.stringify(testPayload);
    const signature = subscription.secret
      ? createHmac("sha256", subscription.secret).update(bodyStr).digest("hex")
      : "";

    try {
      const response = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": "webhook.test",
          "X-Webhook-Signature": signature,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(10_000),
      });

      const success = response.ok;
      return ok(reply, {
        success,
        statusCode: response.status,
        message: success ? "Webhook test delivered successfully" : `Webhook returned status ${response.status}`,
      });
    } catch (err) {
      return ok(reply, {
        success: false,
        statusCode: 0,
        message: `Webhook test failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });
}
