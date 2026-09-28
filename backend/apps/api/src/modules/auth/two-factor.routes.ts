/**
 * Two-Factor Authentication (2FA) Routes.
 * Provides TOTP-based 2FA setup and verification.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import {
  enable2FA,
  confirm2FA,
  verify2FA,
  disable2FA,
  verifyTempToken,
} from "../../lib/two-factor.js";

/** Simple in-memory rate limiter for 2FA verification (5 attempts per minute per key). */
const TWO_FA_LIMIT = 5;
const TWO_FA_WINDOW_MS = 60_000;
const twoFaAttempts = new Map<string, number[]>();

function checkTwoFaRateLimit(key: string): boolean {
  const now = Date.now();
  const attempts = twoFaAttempts.get(key) ?? [];
  const recent = attempts.filter((t) => now - t < TWO_FA_WINDOW_MS);
  if (recent.length >= TWO_FA_LIMIT) return false;
  recent.push(now);
  twoFaAttempts.set(key, recent);
  return true;
}

// Periodic cleanup to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, attempts] of twoFaAttempts) {
    const recent = attempts.filter((t) => now - t < TWO_FA_WINDOW_MS);
    if (recent.length === 0) {
      twoFaAttempts.delete(key);
    } else {
      twoFaAttempts.set(key, recent);
    }
  }
}, TWO_FA_WINDOW_MS);

export default function registerTwoFactorRoutes(app: FastifyInstance) {
  /**
   * Initiate 2FA setup.
   * Returns a TOTP secret and URI for the user to scan with their authenticator app.
   */
  app.post("/v1/auth/2fa/setup", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["auth"],
      summary: "Initiate 2FA setup",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const result = await enable2FA(app.prisma, userId);

    // Store the secret temporarily (2FA not yet enabled until confirmed)
    await app.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: result.secret },
    });

    return ok(reply, {
      secret: result.secret,
      uri: result.uri,
      backupCodes: result.backupCodes,
    });
  });

  /**
   * Confirm 2FA setup.
   * Verifies the first TOTP code and enables 2FA for the user.
   */
  app.post<{
    Body: { code: string };
  }>("/v1/auth/2fa/confirm", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["auth"],
      summary: "Confirm 2FA setup with verification code",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "string", minLength: 6, maxLength: 6 },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const { code } = req.body;

    // Retrieve the pending secret from the user record
    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user?.twoFactorSecret || user.twoFactorEnabled) {
      throw errors.validation("No pending 2FA setup. Call /v1/auth/2fa/setup first.");
    }

    const confirmed = await confirm2FA(app.prisma, userId, code, user.twoFactorSecret);
    if (!confirmed) {
      throw errors.validation("Invalid 2FA code. Please try again.");
    }

    return ok(reply, { success: true, message: "2FA enabled successfully" });
  });

  /**
   * Verify 2FA code during login.
   */
  app.post<{
    Body: { code: string; tempToken: string };
  }>("/v1/auth/2fa/verify", {
    schema: {
      tags: ["auth"],
      summary: "Verify 2FA code during login",
      body: {
        type: "object",
        required: ["code", "tempToken"],
        properties: {
          code: { type: "string", minLength: 6, maxLength: 6 },
          tempToken: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const { code, tempToken } = req.body;

    // Rate limit: max 5 attempts per minute per IP
    if (!checkTwoFaRateLimit(req.ip ?? "unknown")) {
      throw errors.rateLimited("Too many 2FA verification attempts. Try again later.");
    }

    let userId: string;
    try {
      userId = verifyTempToken(tempToken);
    } catch (err) {
      app.log.debug({ err }, "Two-factor temp token verification failed");
      throw errors.validation("Invalid or expired 2FA temp token");
    }

    const verified = await verify2FA(app.prisma, userId, code);
    if (!verified) {
      throw errors.validation("Invalid 2FA code");
    }

    return ok(reply, { success: true });
  });

  /**
   * Disable 2FA.
   */
  app.post<{
    Body: { code: string };
  }>("/v1/auth/2fa/disable", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["auth"],
      summary: "Disable 2FA for the current user",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "string", minLength: 6, maxLength: 6 },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const { code } = req.body;
    await disable2FA(app.prisma, userId, code);

    return ok(reply, { success: true, message: "2FA disabled successfully" });
  });

  /**
   * Get 2FA status.
   */
  app.get("/v1/auth/2fa/status", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["auth"],
      summary: "Get 2FA status for the current user",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const userId = req.user!.sub;
    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });

    return ok(reply, { enabled: user?.twoFactorEnabled ?? false });
  });
}
