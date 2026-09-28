import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { Server as SocketServer, type Socket } from "socket.io";
import { Redis } from "ioredis";
import { getEnv } from "@ai-harness/shared";
import { TASK_EVENTS_CHANNEL, APPROVAL_EVENTS_CHANNEL, DEPLOYMENT_STATUS_CHANNEL } from "@ai-harness/shared";
import { prisma } from "@ai-harness/database";
import { verifyAccessToken } from "../lib/tokens.js";
import { cacheInvalidate } from "../lib/cache.js";
import { createNotificationDispatcher, type NotificationDispatcher, type TaskEventEnvelope } from "../lib/notification-dispatcher.js";

declare module "fastify" {
  interface FastifyInstance {
    io: SocketServer;
    publishTaskEvent: (taskId: string, event: unknown) => void;
    publishDeploymentStatus?: (data: unknown) => void;
    notifications: NotificationDispatcher;
  }
}

/**
 * Realtime task events (FR-010/FR-011).
 * - Browser sockets authenticate with a JWT access token on the handshake.
 * - Clients subscribe per task after membership verification and resume with
 *   `afterSequence` through the REST activity endpoint on reconnect.
 * - Worker-published events arrive over the Redis pub/sub channel, so fan-out
 *   works across API replicas; the in-process bridge covers local single-node dev.
 */
export default fp(async function socketPlugin(app: FastifyInstance) {
  const env = getEnv();
  const io = new SocketServer(app.server, {
    cors: {
      origin: env.FRONTEND_ORIGIN.split(",").map((s) => s.trim()),
      credentials: true,
    },
  });

  const subscriber = new Redis(env.REDIS_URL);
  const publisher = new Redis(env.REDIS_URL);

  subscriber.on("error", (err) => {
    app.log.error({ err }, "Socket.IO Redis subscriber error");
  });
  publisher.on("error", (err) => {
    app.log.error({ err }, "Socket.IO Redis publisher error");
  });

  app.decorate("io", io);
  app.decorate(
    "publishTaskEvent",
    // All room fan-out flows through the Redis channel (the local subscriber
    // receives its own messages), keeping delivery identical across replicas.
    (taskId: string, event: unknown) => {
      void publisher.publish(TASK_EVENTS_CHANNEL, JSON.stringify({ taskId, event }));
    },
  );

  // Notification pipeline: task outcomes, approvals, and deployments dispatch
  // in-app/email/webhook notifications, deduplicated across API replicas via
  // Redis SET NX (see notification-dispatcher.ts).
  app.decorate(
    "notifications",
    createNotificationDispatcher({ prisma, redis: publisher, logger: app.log }),
  );

  app.decorate("publishDeploymentStatus", (data: unknown) => {
    void publisher.publish(DEPLOYMENT_STATUS_CHANNEL, JSON.stringify(data));
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.["token"] as string | undefined;
      if (!token) return next(new Error("UNAUTHENTICATED"));
      socket.data["user"] = await verifyAccessToken(token);
      next();
    } catch (err) {
      app.log.debug({ err }, "Socket authentication failed");
      next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("task:subscribe", async (payload: { taskId?: string }) => {
      const taskId = payload?.taskId;
      const user = socket.data["user"] as { sub: string } | undefined;
      if (!taskId || !user) return;
      try {
        const { prisma } = await import("@ai-harness/database");
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { workspaceId: true },
        });
        if (!task) return;
        const member = await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: task.workspaceId, userId: user.sub } },
        });
        if (!member) return;
        void socket.join(`task:${taskId}`);
      } catch (err) {
        app.log.debug({ err }, "Socket task subscribe failed");
      }
    });

    socket.on("task:unsubscribe", (payload: { taskId?: string }) => {
      if (payload?.taskId) void socket.leave(`task:${payload.taskId}`);
    });
  });

  subscriber.subscribe(TASK_EVENTS_CHANNEL);
  subscriber.subscribe(APPROVAL_EVENTS_CHANNEL);
  subscriber.subscribe(DEPLOYMENT_STATUS_CHANNEL);
  subscriber.on("message", (channel: string, message: string) => {
    if (channel === TASK_EVENTS_CHANNEL) {
      try {
        const parsed = JSON.parse(message) as TaskEventEnvelope;
        // Worker/runtime transitions write task state straight to the DB; this
        // is the single funnel where those events enter the API process —
        // invalidate the query cache or GET /v1/tasks/:id serves stale state
        // for up to the TTL (observed: ~15s lag after every approval).
        void cacheInvalidate(`task:${parsed.taskId}`);
        void cacheInvalidate("tasks:user:*");
        io.to(`task:${parsed.taskId}`).emit("task:event", parsed.event);
        void app.notifications.handleTaskEvent(parsed);
      } catch (err) {
        app.log.debug({ err }, "Socket malformed task event payload");
      }
    } else if (channel === APPROVAL_EVENTS_CHANNEL) {
      try {
        const approval = JSON.parse(message) as { id: string; taskId: string; toolCallId: string | null; status: string; requestedScope: string; expiresAt: string; workspaceId?: string };
        // Task room: the only room clients actually join (task:subscribe).
        if (approval.taskId) io.to(`task:${approval.taskId}`).emit("approval:created", approval);
        if (approval.workspaceId) io.to(`workspace:${approval.workspaceId}`).emit("approval:created", approval);
        void app.notifications.handleApprovalCreated(approval);
      } catch (err) {
        app.log.debug({ err }, "Socket malformed approval event payload");
      }
    } else if (channel === DEPLOYMENT_STATUS_CHANNEL) {
      try {
        const status = JSON.parse(message) as { deploymentId: string; status: string; failureReason?: string };
        io.emit("deployment:updated", status);
        void app.notifications.handleDeploymentStatus(status);
      } catch (err) {
        app.log.debug({ err }, "Socket malformed deployment status payload");
      }
    }
  });

  app.addHook("onClose", async () => {
    subscriber.disconnect();
    publisher.disconnect();
    io.close();
  });
});
