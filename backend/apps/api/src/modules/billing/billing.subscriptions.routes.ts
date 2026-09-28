/**
 * Subscription Listing Routes.
 * List subscriptions for a workspace.
 */
import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";

export default function registerBillingSubscriptionRoutes(app: FastifyInstance) {
  /**
   * List subscriptions for the workspace.
   */
  app.get("/v1/billing/subscriptions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["billing"],
      summary: "List subscriptions for the workspace",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          limit: { type: "integer", default: 50 },
          offset: { type: "integer", default: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId: string; limit?: number; offset?: number };
    await app.requireWorkspaceRole(req, query.workspaceId, "VIEWER");

    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const where = { workspaceId: query.workspaceId };

    const [subscriptions, total] = await Promise.all([
      app.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      app.prisma.subscription.count({ where }),
    ]);

    return ok(reply, { subscriptions, total, limit, offset });
  });
}
