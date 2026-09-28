import type { PrismaClient } from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";

export interface CreateNotificationInput {
  userId: string;
  title: string;
  message: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationListQuery {
  userId: string;
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function createNotificationService(
  prisma: PrismaClient,
  onCreated?: (notification: { id: string; userId: string; title: string; message: string; type: string; metadata: unknown }) => void,
) {
  return {
    async create(input: CreateNotificationInput) {
      const notification = await prisma.notification.create({
        data: {
          userId: input.userId,
          title: input.title,
          message: input.message,
          type: input.type,
          metadata: (input.metadata as InputJsonValue) ?? undefined,
        },
      });
      onCreated?.(notification);
      return notification;
    },

    async list(query: NotificationListQuery) {
      const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

      return prisma.notification.findMany({
        where: {
          userId: query.userId,
          ...(query.unreadOnly ? { readAt: null } : {}),
          ...(query.cursor
            ? { createdAt: { lt: new Date(query.cursor) } }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
      }).then((rows: Array<{ id: string; createdAt: Date; [key: string]: unknown }>) => {
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        return {
          items,
          nextCursor: hasMore ? items[items.length - 1]?.createdAt.toISOString() : null,
        };
      });
    },

    async countUnread(userId: string) {
      return prisma.notification.count({
        where: { userId, readAt: null },
      });
    },

    async markRead(userId: string, notificationId: string) {
      return prisma.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: new Date() },
      });
    },

    async markAllRead(userId: string) {
      return prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });
    },

    async deleteOne(userId: string, notificationId: string) {
      return prisma.notification.deleteMany({
        where: { id: notificationId, userId },
      });
    },

    async deleteAll(userId: string) {
      return prisma.notification.deleteMany({
        where: { userId },
      });
    },
  };
}
