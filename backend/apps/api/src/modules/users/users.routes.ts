import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok } from "../../lib/http.js";

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().max(2000).nullable().optional(),
});

/** Account profile + session management (account-management phase scope). */
export default function registerUserRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  app.patch("/v1/users/me", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["users"],
      summary: "Update the authenticated user's profile",
    },
  }, async (req, reply) => {
    const input = updateMeSchema.parse(req.body);
    const user = await app.prisma.user.update({
      where: { id: req.user!.sub },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
    });
    await audit.record({
      actorUserId: user.id,
      action: "PROFILE_UPDATED",
      entityType: "USER",
      entityId: user.id,
      metadata: { fields: Object.keys(input) },
    });
    return ok(reply, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    });
  });

  app.get("/v1/auth/sessions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["users"],
      summary: "List active sessions for the user",
    },
  }, async (req, reply) => {
    const sessions = await app.prisma.refreshSession.findMany({
      where: { userId: req.user!.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, expiresAt: true },
    });
    const currentSid = req.user!.sid;
    return ok(
      reply,
      sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === currentSid,
      })),
    );
  });

  app.delete("/v1/auth/sessions/:sessionId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["users"],
      summary: "Revoke a specific session",
      params: {
        type: "object",
        required: ["sessionId"],
        properties: { sessionId: { type: "string" } },
      },
    },
  }, async (req, reply) => {
    const sessionId = (req.params as Record<string, string>).sessionId ?? "";
    if (!sessionId) throw errors.validation("Missing session id");
    const result = await app.prisma.refreshSession.updateMany({
      where: { id: sessionId, userId: req.user!.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw errors.notFound("Session");
    await audit.record({
      actorUserId: req.user!.sub,
      action: "SESSION_REVOKED",
      entityType: "REFRESH_SESSION",
      entityId: sessionId,
    });
    return ok(reply, { success: true });
  });

  /** Sign out everywhere except this device. */
  app.post("/v1/auth/sessions/revoke-others", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["users"],
      summary: "Revoke all other sessions except the current one",
    },
  }, async (req, reply) => {
    const sid = req.user!.sid;
    const result = await app.prisma.refreshSession.updateMany({
      where: { userId: req.user!.sub, revokedAt: null, ...(sid ? { id: { not: sid } } : {}) },
      data: { revokedAt: new Date() },
    });
    await audit.record({
      actorUserId: req.user!.sub,
      action: "SESSIONS_REVOKED_OTHERS",
      entityType: "USER",
      entityId: req.user!.sub,
      metadata: { count: result.count },
    });
    return ok(reply, { revoked: result.count });
  });
}
