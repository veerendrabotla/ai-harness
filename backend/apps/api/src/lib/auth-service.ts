import argon2 from "argon2";
import type { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";
import { errors, generateOpaqueToken, getEnv } from "@ai-harness/shared";
import {
  createUserRepository,
  createSessionRepository,
  createPasswordResetRepository,
  createAuditRepository,
} from "@ai-harness/database";
import { signAccessToken } from "./tokens.js";

/** Sentinel marker for accounts managed entirely by SSO (no local password). */
export const SSO_MANAGED_MARKER = "__SSO_MANAGED__";

// Module-level logger (pino) — avoids passing app into AuthService
let _logger: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void } | null = null;
function getLogger() {
  if (!_logger) {
    try {
      // Lazy require via createRequire: `require` is not defined in ESM
      // (the API runs as type:module under tsx), which silently degraded this
      // logger to a no-op and dropped dev-only token logs.
      const requireFromMeta = createRequire(import.meta.url);
      const pinoLib = requireFromMeta("pino");
      _logger = (pinoLib.default ?? pinoLib)({ name: "auth-service", level: "warn" });
    } catch {
      // Fallback: no-op if pino unavailable at import time
      _logger = { warn: () => {}, error: () => {} };
    }
  }
  return _logger;
}

/**
 * Authentication service — Argon2id hashing, JWT access tokens and
 * rotating opaque refresh sessions (TECH_STACK.md §6).
 */
export class AuthService {
  private readonly users;
  private readonly sessions;
  private readonly resets;
  private readonly audit;

  constructor(private readonly prisma: PrismaClient) {
    this.users = createUserRepository(prisma);
    this.sessions = createSessionRepository(prisma);
    this.resets = createPasswordResetRepository(prisma);
    this.audit = createAuditRepository(prisma);
  }

  private hashPassword(password: string): Promise<string> {
    // OWASP-recommended Argon2id parameters.
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async signup(input: { email: string; password: string; displayName: string }) {
    const existing = await this.users.findByEmail(input.email);
    if (existing) throw errors.conflict("An account with this email already exists");
    const user = await this.users.create({
      email: input.email,
      passwordHash: await this.hashPassword(input.password),
      displayName: input.displayName,
    });
    await this.audit.record({
      actorUserId: user.id,
      action: "USER_SIGNUP",
      entityType: "USER",
      entityId: user.id,
    });
    const tokens = await this.issueSession(user.id, user.email);
    return { ...tokens, user };
  }

  async login(input: { email: string; password: string }) {
    const user = await this.users.findByEmail(input.email);
    // Constant-shape failure: never reveal whether the email exists.
    if (!user || user.status !== "ACTIVE") throw errors.unauthenticated("Invalid email or password");
    // SSO-only accounts cannot log in with a password
    if (user.passwordHash === SSO_MANAGED_MARKER) {
      throw errors.unauthenticated("This account uses SSO. Please log in with your identity provider.");
    }
    const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) throw errors.unauthenticated("Invalid email or password");
    const tokens = await this.issueSession(user.id, user.email);
    return { ...tokens, user };
  }

  /** Refresh with rotation + reuse detection. Returns new tokens or throws UNAUTHENTICATED. */
  async refresh(rawToken: string) {
    if (!rawToken) throw errors.unauthenticated("Missing refresh token");
    const session = await this.sessions.findActiveByToken(rawToken);
    if (!session) {
      // Reuse of a rotated token → revoke everything for that account.
      const any = await this.sessions.findByTokenAny(rawToken);
      if (any && any.revokedAt) {
        await this.sessions.revokeAllForUser(any.userId);
      }
      throw errors.unauthenticated("Refresh session is invalid or expired");
    }
    const env = getEnv();
    const newRaw = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const rotated = await this.sessions.rotate(session.id, newRaw, expiresAt);
    if (!rotated) throw errors.unauthenticated("Refresh session is invalid or expired");
    const accessToken = await signAccessToken({ sub: session.userId, email: session.user.email, sid: rotated.id });
    return { accessToken, refreshToken: newRaw, user: session.user };
  }

  async logout(rawToken: string | undefined, userId: string) {
    if (rawToken) {
      const session = await this.sessions.findActiveByToken(rawToken);
      if (session) await this.sessions.revoke(session.id);
    } else {
      await this.sessions.revokeAllForUser(userId);
    }
    await this.audit.record({ actorUserId: userId, action: "USER_LOGOUT", entityType: "USER", entityId: userId });
    return { success: true };
  }

  /** Always succeeds outward; token delivery is handled out-of-band (email phase). */
  async forgotPassword(email: string): Promise<{ created: boolean }> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== "ACTIVE") return { created: false };
    const raw = generateOpaqueToken(32);
    const ttlMin = getEnv().PASSWORD_RESET_TTL_MINUTES;
    await this.resets.create(user.id, raw, new Date(Date.now() + ttlMin * 60 * 1000));
    await this.audit.record({ actorUserId: user.id, action: "PASSWORD_RESET_REQUESTED", entityType: "USER", entityId: user.id });
    const apiKey = getEnv().RESEND_API_KEY;
    const from = getEnv().RESEND_FROM;
    if (apiKey && from) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from,
          to: email,
          subject: "Reset your AI Harness password",
          text: `Use this token within ${ttlMin} minutes to reset your password:\n\n${raw}\n`,
        });
      } catch (err) {
        getLogger()?.error({ err: err instanceof Error ? err.message : err }, "Failed to send reset email");
      }
    }
    if (process.env.NODE_ENV !== "production") {
      getLogger()?.warn({ email, token: raw }, "Dev password reset token");
    }
    return { created: true };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.resets.consume(rawToken);
    if (!record) throw errors.validation("Reset token is invalid or expired");
    const user = await this.users.findById(record.userId);
    if (!user) throw errors.notFound("User");
    await this.users.updatePasswordHash(user.id, await this.hashPassword(newPassword));
    await this.sessions.revokeAllForUser(user.id);
    await this.audit.record({ actorUserId: user.id, action: "PASSWORD_RESET_COMPLETED", entityType: "USER", entityId: user.id });
  }

  private async issueSession(userId: string, email: string) {
    const env = getEnv();
    const refreshRaw = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const session = await this.sessions.create(userId, refreshRaw, expiresAt);
    const accessToken = await signAccessToken({ sub: userId, email, sid: session.id });
    return { accessToken, refreshToken: refreshRaw };
  }

  /**
   * Find or create a user from OAuth provider (GitHub, Google, etc.).
   * Returns existing user if email matches, or creates new user.
   */
  async findOrCreateOAuthUser(input: {
    email: string;
    displayName: string;
    avatarUrl?: string;
    provider: string;
    providerId: string;
  }) {
    // Check if user exists by email
    let user = await this.users.findByEmail(input.email);

    if (user) {
      // Update avatar if provided
      if (input.avatarUrl && user.avatarUrl !== input.avatarUrl) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl: input.avatarUrl },
        });
      }
    } else {
      // Create new user (no password hash for OAuth users)
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash: SSO_MANAGED_MARKER,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          status: "ACTIVE",
        },
      });
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "USER_OAUTH_LOGIN",
      entityType: "USER",
      entityId: user.id,
      metadata: { provider: input.provider, providerId: input.providerId },
    });

    const tokens = await this.issueSession(user.id, user.email);
    return { ...tokens, user };
  }
}

export function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
