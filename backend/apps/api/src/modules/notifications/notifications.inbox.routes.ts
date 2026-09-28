import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { createNotificationService } from "./notifications.service.js";

export default function registerInboxRoutes(app: FastifyInstance) {
  const svc = createNotificationService(app.prisma, (notification) => {
    void app.io?.to(`user:${notification.userId}`).emit("notification:created", notification);
  });

  app.get("/v1/notifications", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "List in-app notifications for the authenticated user",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          unreadOnly: { type: "boolean" },
          cursor: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const q = req.query as {
      unreadOnly?: boolean;
      cursor?: string;
      limit?: number;
    };

    const result = await svc.list({
      userId,
      unreadOnly: q.unreadOnly,
      cursor: q.cursor,
      limit: q.limit,
    });

    return ok(reply, result);
  });

  app.get("/v1/notifications/unread-count", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Get count of unread notifications",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const count = await svc.countUnread(userId);
    return ok(reply, { count });
  });

  app.post<{
    Params: { notificationId: string };
  }>("/v1/notifications/:notificationId/read", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Mark a notification as read",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["notificationId"],
        properties: { notificationId: { type: "string" } },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const notificationId = (req.params as { notificationId: string }).notificationId;
    await svc.markRead(userId, notificationId);
    return ok(reply, { success: true });
  });

  app.post("/v1/notifications/read-all", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Mark all notifications as read",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const result = await svc.markAllRead(userId);
    return ok(reply, { updated: result.count });
  });

  app.delete<{
    Params: { notificationId: string };
  }>("/v1/notifications/:notificationId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Delete a notification",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["notificationId"],
        properties: { notificationId: { type: "string" } },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const notificationId = (req.params as { notificationId: string }).notificationId;
    await svc.deleteOne(userId, notificationId);
    return ok(reply, { success: true });
  });

  app.delete("/v1/notifications", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["notifications"],
      summary: "Delete all notifications for the authenticated user",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    const result = await svc.deleteAll(userId);
    return ok(reply, { deleted: result.count });
  });
}
