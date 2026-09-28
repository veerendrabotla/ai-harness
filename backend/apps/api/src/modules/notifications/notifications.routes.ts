import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import {
  UNSUBSCRIBE_TYPES,
  createUnsubscribe,
  removeUnsubscribe,
  getUnsubscribes,
} from "../../lib/email-unsubscribe.js";
import { getDeliveryStats } from "../../lib/email-delivery.js";

export default function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/v1/notifications/preferences", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Get notification preferences",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });

    return ok(reply, user?.notificationPreferences ?? {
      email: true,
      inApp: true,
      push: false,
      webhook: false,
    });
  });

  app.put("/v1/notifications/preferences", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Update notification preferences",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          email: { type: "boolean" },
          inApp: { type: "boolean" },
          push: { type: "boolean" },
          webhook: { type: "boolean" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const prefs = req.body as {
      email?: boolean;
      inApp?: boolean;
      push?: boolean;
      webhook?: boolean;
    };

    const user = await app.prisma.user.update({
      where: { id: userId },
      data: { notificationPreferences: prefs },
      select: { notificationPreferences: true },
    });

    return ok(reply, user.notificationPreferences);
  });

  /**
   * Get available unsubscribe types.
   */
  app.get("/v1/notifications/unsubscribe-types", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Get available unsubscribe types",
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    return ok(reply, UNSUBSCRIBE_TYPES);
  });

  /**
   * Get unsubscribes for current user.
   */
  app.get("/v1/notifications/unsubscribes", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Get your email unsubscribes",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw errors.notFound("User");

    const unsubscribes = await getUnsubscribes(app.prisma, user.email);
    return ok(reply, unsubscribes);
  });

  /**
   * Unsubscribe from a notification type.
   */
  app.post("/v1/notifications/unsubscribe", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Unsubscribe from a notification type",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["type"],
        properties: {
          type: { type: "string", enum: [...UNSUBSCRIBE_TYPES] },
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const { type, workspaceId } = req.body as { type: string; workspaceId?: string };
    if (!UNSUBSCRIBE_TYPES.includes(type as typeof UNSUBSCRIBE_TYPES[number])) {
      throw errors.validation("Invalid unsubscribe type");
    }

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw errors.notFound("User");

    await createUnsubscribe(app.prisma, user.email, type as typeof UNSUBSCRIBE_TYPES[number], workspaceId);
    return ok(reply, { success: true });
  });

  /**
   * Re-subscribe to a notification type.
   */
  app.delete("/v1/notifications/unsubscribe/:type", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Re-subscribe to a notification type",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["type"],
        properties: { type: { type: "string" } },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const type = (req.params as { type: string }).type;
    if (!UNSUBSCRIBE_TYPES.includes(type as typeof UNSUBSCRIBE_TYPES[number])) {
      throw errors.validation("Invalid unsubscribe type");
    }

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw errors.notFound("User");

    await removeUnsubscribe(app.prisma, user.email, type as typeof UNSUBSCRIBE_TYPES[number]);
    return ok(reply, { success: true });
  });

  /**
   * Get email delivery stats for a workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/email-stats", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Get email delivery statistics",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const stats = await getDeliveryStats(app.prisma, workspaceId);
    return ok(reply, stats);
  });
}
