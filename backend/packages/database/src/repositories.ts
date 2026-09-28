import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sha256Hex } from "@ai-harness/shared";

type Db = PrismaClient;

/** User repository — authentication data access. */
export function createUserRepository(db: Db) {
  return {
    findByEmail(email: string) {
      return db.user.findUnique({ where: { email: email.toLowerCase() } });
    },
    findById(id: string) {
      return db.user.findUnique({ where: { id } });
    },
    async create(input: { email: string; passwordHash: string; displayName: string }) {
      return db.user.create({
        data: {
          id: randomUUID(),
          email: input.email.toLowerCase(),
          passwordHash: input.passwordHash,
          displayName: input.displayName,
        },
      });
    },
    updatePasswordHash(userId: string, passwordHash: string) {
      return db.user.update({ where: { id: userId }, data: { passwordHash } });
    },
  };
}

/** Refresh session repository — hashed opaque tokens with rotation support. */
export function createSessionRepository(db: Db) {
  return {
    hashToken(token: string): string {
      return sha256Hex(token);
    },
    create(userId: string, rawToken: string, expiresAt: Date) {
      return db.refreshSession.create({
        data: { userId, tokenHash: sha256Hex(rawToken), expiresAt },
      });
    },
    findActiveByToken(rawToken: string) {
      return db.refreshSession.findFirst({
        where: {
          tokenHash: sha256Hex(rawToken),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
      });
    },
    /** Detects reuse of an already-rotated token (security signal). */
    findByTokenAny(rawToken: string) {
      return db.refreshSession.findUnique({
        where: { tokenHash: sha256Hex(rawToken) },
        include: { user: true },
      });
    },
    /**
     * Rotates a session: revokes the old row (guarded so double-rotation loses
     * the race safely) then issues the new one. Two statements instead of a
     * transaction; the guarded update makes the rotation idempotent.
     */
    async rotate(oldSessionId: string, newRawToken: string, newExpiresAt: Date) {
      const old = await db.refreshSession.findUnique({
        where: { id: oldSessionId },
        select: { userId: true },
      });
      if (!old) return null;
      const revoked = await db.refreshSession.updateMany({
        where: { id: oldSessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) return null; // someone else already rotated
      return db.refreshSession.create({
        data: { userId: old.userId, tokenHash: sha256Hex(newRawToken), expiresAt: newExpiresAt },
      });
    },
    revoke(sessionId: string) {
      return db.refreshSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    revokeAllForUser(userId: string) {
      return db.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}

/** Single-use password reset tokens (hashed, TTL enforced at query time). */
export function createPasswordResetRepository(db: Db) {
  return {
    create(userId: string, rawToken: string, expiresAt: Date) {
      return db.passwordResetToken.create({
        data: { userId, tokenHash: sha256Hex(rawToken), expiresAt },
      });
    },
    /** Single-use consumption guarded by updateMany — safe without a transaction. */
    async consume(rawToken: string) {
      const record = await db.passwordResetToken.findFirst({
        where: {
          tokenHash: sha256Hex(rawToken),
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!record) return null;
      const won = await db.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return won.count === 1 ? record : null;
    },
  };
}

export interface MembershipView {
  workspaceId: string;
  role: "OWNER" | "MEMBER" | "VIEWER";
}

/** Workspace + membership authorization queries (FR-002). */
export function createWorkspaceRepository(db: Db) {
  return {
    findById(id: string) {
      return db.workspace.findUnique({ where: { id }, include: { policy: true } });
    },
    membership(workspaceId: string, userId: string) {
      return db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true, workspaceId: true },
      }) as Promise<MembershipView | null>;
    },
    listForUser(userId: string) {
      return db.workspace.findMany({
        where: { members: { some: { userId } } },
        orderBy: { createdAt: "desc" },
      });
    },
    async createWithDefaults(input: {
      ownerId: string;
      name: string;
      description?: string | null;
      executionMode: "CLOUD" | "LOCAL_CONNECTED" | "HYBRID";
      initialInstructions?: string | null;
    }) {
      return db.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: {
            ownerId: input.ownerId,
            name: input.name,
            description: input.description ?? null,
            executionMode: input.executionMode,
            members: { create: { userId: input.ownerId, role: "OWNER" } },
            policy: { create: {} },
          },
          include: { policy: true },
        });
        if (input.initialInstructions && input.initialInstructions.trim().length > 0) {
          await tx.workspaceInstructionVersion.create({
            data: {
              workspaceId: workspace.id,
              version: 1,
              content: input.initialInstructions,
              createdBy: input.ownerId,
            },
          });
        }
        return workspace;
      });
    },
    latestInstructions(workspaceId: string) {
      return db.workspaceInstructionVersion.findFirst({
        where: { workspaceId },
        orderBy: { version: "desc" },
      });
    },
    nextInstructionVersion(workspaceId: string) {
      return db.workspaceInstructionVersion.aggregate({
        where: { workspaceId },
        _max: { version: true },
      });
    },
    policyWithRules(workspaceId: string) {
      return db.workspacePolicy.findUnique({
        where: { workspaceId },
        include: { toolRules: true },
      });
    },
  };
}

/** Audit log append-only helper (PRD F-17). */
export function createAuditRepository(db: Db) {
  return {
    record(entry: {
      actorUserId?: string | null;
      workspaceId?: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      return db.auditLog.create({
        data: {
          actorUserId: entry.actorUserId ?? null,
          workspaceId: entry.workspaceId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : undefined,
        },
      });
    },
  };
}
