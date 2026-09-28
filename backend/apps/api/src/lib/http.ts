import type { FastifyReply, FastifyRequest } from "fastify";
import { errors } from "@ai-harness/shared";

export function ok(reply: FastifyReply, data: unknown, statusCode = 200): FastifyReply {
  return reply.code(statusCode).send({ data, requestId: reply.request.id });
}

/** Typed path-param accessor (route schemas are declared at runtime). */
export function reqParam(req: FastifyRequest, name: string): string {
  const params = (req.params ?? {}) as Record<string, unknown>;
  const value = params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw errors.validation(`Missing path parameter '${name}'`);
  }
  return value;
}
