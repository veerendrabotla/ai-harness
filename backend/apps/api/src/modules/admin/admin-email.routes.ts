/**
 * Email Delivery Admin Routes.
 * Admin viewer for email delivery records.
 */
import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";

export default function registerAdminEmailRoutes(app: FastifyInstance) {
  const adminPreHandler = [app.authenticate, app.requirePlatformAdmin];

  /**
   * List email deliveries (admin only).
   */
  app.get("/v1/admin/email-deliveries", {
    preHandler: adminPreHandler,
    schema: {
      tags: ["admin", "email"],
      summary: "List email deliveries (platform admin only)",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          status: { type: "string" },
          templateType: { type: "string" },
          recipientEmail: { type: "string" },
          limit: { type: "integer", default: 50 },
          offset: { type: "integer", default: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as {
      status?: string;
      templateType?: string;
      recipientEmail?: string;
      limit?: number;
      offset?: number;
    };
    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.templateType) where.templateType = query.templateType;
    if (query.recipientEmail) where.recipientEmail = { contains: query.recipientEmail };

    const [deliveries, total] = await Promise.all([
      app.prisma.emailDelivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      app.prisma.emailDelivery.count({ where }),
    ]);

    return ok(reply, { deliveries, total, limit, offset });
  });
}
