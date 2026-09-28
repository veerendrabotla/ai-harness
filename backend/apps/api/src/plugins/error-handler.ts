import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError, getEnv, redactValue } from "@ai-harness/shared";
import type { ApiErrorBody } from "@ai-harness/contracts";

/**
 * Centralized error handling (BACKEND_STRUCTURE.md §6).
 * Raw stack traces are logged server-side only; clients receive structured codes.
 */
export default fp(async function errorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.id;

    if (err instanceof AppError) {
      const body: ApiErrorBody = {
        error: { code: err.code, message: err.message, details: err.details },
        requestId,
      };
      if (err.status >= 500) req.log.error({ err: redactValue(err.stack) }, "app error");
      return reply.code(err.status).send(body);
    }

    if (err instanceof ZodError) {
      const body: ApiErrorBody = {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request payload failed validation",
          details: {
            issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        },
        requestId,
      };
      return reply.code(400).send(body);
    }

    // fastify rate-limit errors carry statusCode 429
    if ((err as { statusCode?: number }).statusCode === 429) {
      const body: ApiErrorBody = {
        error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." },
        requestId,
      };
      return reply.code(429).send(body);
    }

    // Fastify schema/ajv errors (FST_ERR_VALIDATION etc.) carry a 4xx status —
    // they must surface as client errors, not INTERNAL_ERROR 500.
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const code =
        status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR";
      const body: ApiErrorBody = {
        error: { code, message: err instanceof Error ? err.message : "Request validation failed" },
        requestId,
      };
      return reply.code(status).send(body);
    }

    const env = getEnv();
    req.log.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, "unhandled error");
    const body: ApiErrorBody = {
      error: {
        code: "INTERNAL_ERROR",
        message:
          env.NODE_ENV === "production"
            ? "An unexpected internal error occurred"
            : `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      },
      requestId,
    };
    return reply.code(500).send(body);
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const body: ApiErrorBody = {
      error: { code: "NOT_FOUND", message: "Route not found" },
      requestId: req.id,
    };
    return reply.code(404).send(body);
  });
});
