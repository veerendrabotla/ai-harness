/**
 * Audit Log Service.
 * Centralized audit logging for all API operations.
 */
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import pino from "pino";

const log = pino({ name: "audit", level: "warn" });

export type AuditAction =
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_REGISTER"
  | "WORKSPACE_CREATED"
  | "WORKSPACE_UPDATED"
  | "WORKSPACE_MEMBER_ADDED"
  | "WORKSPACE_MEMBER_REMOVED"
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "TASK_CREATED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_CANCELLED"
  | "DEPLOYMENT_STARTED"
  | "DEPLOYMENT_COMPLETED"
  | "DEPLOYMENT_FAILED"
  | "DEPLOYMENT_ROLLED_BACK"
  | "PROVIDER_CONNECTED"
  | "PROVIDER_DISCONNECTED"
  | "MCP_SERVER_ADDED"
  | "MCP_SERVER_REMOVED"
  | "BRIDGE_CONNECTED"
  | "BRIDGE_DISCONNECTED"
  | "ADMIN_USER_UPDATED"
  | "ADMIN_USER_DEACTIVATED"
  | "ORG_CREATED"
  | "ORG_MEMBER_ADDED"
  | "ORG_MEMBER_REMOVED"
  | "TWO_FACTOR_ENABLED"
  | "TWO_FACTOR_DISABLED"
  | "BUILDER_PROJECT_CREATED"
  | "CUSTOM_ROLE_CREATED"
  | "CUSTOM_ROLE_UPDATED"
  | "CUSTOM_ROLE_DELETED";

export type AuditEntityType =
  | "USER"
  | "WORKSPACE"
  | "PROJECT"
  | "TASK"
  | "DEPLOYMENT"
  | "PROVIDER"
  | "MCP_SERVER"
  | "BRIDGE"
  | "ORGANIZATION"
  | "SESSION"
  | "SYSTEM";

export interface AuditContext {
  userId?: string;
  workspaceId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create an audit log entry.
 */
export async function createAuditLog(
  prisma: PrismaClient,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string | null,
  context: AuditContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLogEntry.create({
      data: {
        userId: context.userId ?? null,
        workspaceId: context.workspaceId ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) as never : undefined,
      },
    });
  } catch (err) {
    // Audit log failures should not break the request
    log.error({ err }, "[AuditLog] Failed to create audit entry:");
  }
}

/**
 * Extract audit context from a Fastify request.
 */
export function extractAuditContext(
  req: FastifyRequest,
  workspaceId?: string,
): AuditContext {
  return {
    userId: req.user?.sub,
    workspaceId,
    ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      ?? req.headers["x-real-ip"] as string
      ?? req.ip
      ?? undefined,
    userAgent: req.headers["user-agent"] as string ?? undefined,
  };
}

/**
 * Create audit log from a request.
 */
export async function auditFromRequest(
  prisma: PrismaClient,
  req: FastifyRequest,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string | null,
  workspaceId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const context = extractAuditContext(req, workspaceId);
  await createAuditLog(prisma, action, entityType, entityId, context, metadata);
}
