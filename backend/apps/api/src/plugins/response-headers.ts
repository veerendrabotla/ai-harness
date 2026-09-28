import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { apiMetrics } from "../lib/metrics.js";

/**
 * Adds response time headers to all responses and records HTTP metrics.
 * - X-Response-Time: Time taken to process the request (ms)
 */
export default fp(async function responseHeaders(app: FastifyInstance) {
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.startTime = Date.now();
  });

  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const responseTime = Date.now() - (req.startTime ?? Date.now());
    reply.header("X-Response-Time", `${responseTime}ms`);

    const route = (req.routeOptions?.url ?? "unmatched").replace(/\/:[^/]+/g, "/:param");
    const labels = { method: req.method, statusCode: String(reply.statusCode), route };
    apiMetrics.increment("http_requests_total", labels);
    apiMetrics.timer("http_request_duration_ms", responseTime, { method: req.method, route });
    if (reply.statusCode >= 500) {
      apiMetrics.increment("http_errors_total", { statusCode: String(reply.statusCode), route });
    }
  });
});

declare module "fastify" {
  interface FastifyRequest {
    startTime?: number;
  }
}
