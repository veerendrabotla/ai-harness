import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  Session,
  SessionStatus,
  ConversationMessage,
  ToolCallRecord,
  PlanRecord,
  ApprovalRecord,
  SessionForkResult,
} from "./types.js";

/**
 * Prisma-backed Session Engine.
 * Provides persistent session storage using PostgreSQL.
 */
export class PrismaSessionEngine {
  constructor(private readonly prisma: PrismaClient) {}

  async createSession(config: {
    name: string;
    projectId: string;
    workspaceId: string;
    model?: string;
    provider?: string;
  }): Promise<Session> {
    const session = await this.prisma.session.create({
      data: {
        name: config.name,
        projectId: config.projectId,
        workspaceId: config.workspaceId,
        status: "ACTIVE",
        conversation: [],
        toolCalls: [],
        plans: [],
        approvals: [],
        filesChanged: [],
        checkpoints: [],
        modelInfo: {
          provider: config.provider || "unknown",
          model: config.model || "unknown",
          tokensUsed: 0,
        },
        executionProvider: "unknown",
        agentState: { mode: "build", phase: "idle", iteration: 0 },
        verification: { passed: false, tests: [] },
        memoryReferences: [],
      },
    });

    return this.toSession(session);
  }

  async resumeSession(sessionId: string): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status === "DELETED") return null;

    const updated = await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "ACTIVE" },
    });

    return this.toSession(updated);
  }

  async pauseSession(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE") return false;

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "PAUSED" },
    });

    return true;
  }

  async forkSession(sessionId: string, name?: string): Promise<SessionForkResult | null> {
    const original = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!original) return null;

    const forked = await this.prisma.session.create({
      data: {
        name: name || `${original.name} (fork)`,
        projectId: original.projectId,
        workspaceId: original.workspaceId,
        status: "ACTIVE",
        conversation: original.conversation as never,
        toolCalls: original.toolCalls as never,
        plans: original.plans as never,
        approvals: original.approvals as never,
        filesChanged: original.filesChanged,
        checkpoints: original.checkpoints,
        modelInfo: original.modelInfo as never,
        executionProvider: original.executionProvider as never,
        agentState: original.agentState as never,
        verification: original.verification as never,
        deployment: original.deployment as never,
        memoryReferences: original.memoryReferences as never,
        forkedFrom: sessionId,
      },
    });

    return {
      originalSessionId: sessionId,
      newSessionId: forked.id,
      forkPoint: (original.conversation as unknown[]).length,
    };
  }

  async cloneSession(sessionId: string, name?: string): Promise<Session | null> {
    const original = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!original) return null;

    const cloned = await this.prisma.session.create({
      data: {
        name: name || `${original.name} (clone)`,
        projectId: original.projectId,
        workspaceId: original.workspaceId,
        status: "ACTIVE",
        conversation: original.conversation as never,
        toolCalls: original.toolCalls as never,
        plans: original.plans as never,
        approvals: original.approvals as never,
        filesChanged: original.filesChanged,
        checkpoints: original.checkpoints,
        modelInfo: original.modelInfo as never,
        executionProvider: original.executionProvider as never,
        agentState: original.agentState as never,
        verification: original.verification as never,
        deployment: original.deployment as never,
        memoryReferences: original.memoryReferences as never,
        forkedFrom: sessionId,
      },
    });

    return this.toSession(cloned);
  }

  async exportSession(sessionId: string): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return null;
    return this.toSession(session);
  }

  async importSession(data: Session): Promise<Session> {
    const session = await this.prisma.session.create({
      data: {
        name: data.name,
        projectId: data.projectId,
        workspaceId: data.workspaceId,
        status: "ACTIVE",
        conversation: data.conversation as never,
        toolCalls: data.toolCalls as never,
        plans: data.plans as never,
        approvals: data.approvals as never,
        filesChanged: data.filesChanged,
        checkpoints: data.checkpoints,
        modelInfo: data.modelInfo as never,
        executionProvider: data.executionProvider,
        agentState: data.agentState as never,
        verification: data.verification as never,
        deployment: data.deployment as never,
        memoryReferences: data.memoryReferences,
        forkedFrom: data.forkedFrom,
      },
    });

    return this.toSession(session);
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return false;

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    return true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return false;

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "DELETED" },
    });

    return true;
  }

  async restoreSession(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "DELETED") return false;

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "ACTIVE", archivedAt: null },
    });

    return true;
  }

  async addMessage(sessionId: string, message: Omit<ConversationMessage, "id" | "timestamp">): Promise<ConversationMessage | null> {
    const msg: ConversationMessage = {
      id: randomUUID(),
      ...message,
      timestamp: new Date(),
    };

    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { id: sessionId }, select: { conversation: true, status: true } });
      if (!session || session.status !== "ACTIVE") throw new Error("Session not found");
      const conversation = (session.conversation as unknown[] ?? []);
      await tx.session.update({ where: { id: sessionId }, data: { conversation: [...conversation, msg] as never } });
    });

    return msg;
  }

  async addToolCall(sessionId: string, call: Omit<ToolCallRecord, "id" | "timestamp">): Promise<ToolCallRecord | null> {
    const record: ToolCallRecord = {
      id: randomUUID(),
      ...call,
      timestamp: new Date(),
    };

    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { id: sessionId }, select: { toolCalls: true, status: true } });
      if (!session || session.status !== "ACTIVE") throw new Error("Session not found");
      const toolCalls = (session.toolCalls as unknown[] ?? []);
      await tx.session.update({ where: { id: sessionId }, data: { toolCalls: [...toolCalls, record] as never } });
    });

    return record;
  }

  async addPlan(sessionId: string, plan: Omit<PlanRecord, "id" | "timestamp">): Promise<PlanRecord | null> {
    const record: PlanRecord = {
      id: randomUUID(),
      ...plan,
      timestamp: new Date(),
    };

    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { id: sessionId }, select: { plans: true, status: true } });
      if (!session || session.status !== "ACTIVE") throw new Error("Session not found");
      const plans = (session.plans as unknown[] ?? []);
      await tx.session.update({ where: { id: sessionId }, data: { plans: [...plans, record] as never } });
    });

    return record;
  }

  async approvePlan(sessionId: string, planId: string, approvedBy: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return false;

    const plans = session.plans as unknown[] as PlanRecord[];
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return false;

    plan.approved = true;
    plan.approvedBy = approvedBy;

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { plans: plans as never },
    });

    return true;
  }

  async searchSessions(query: {
    projectId?: string;
    workspaceId?: string;
    status?: SessionStatus;
    limit?: number;
  }): Promise<Session[]> {
    const where: Record<string, unknown> = {};
    if (query.projectId) where.projectId = query.projectId;
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.status) where.status = query.status.toUpperCase();

    const sessions = await this.prisma.session.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: query.limit,
    });

    return sessions.map((s) => this.toSession(s));
  }

  getSession(sessionId: string): Promise<Session | undefined> {
    return this.prisma.session.findUnique({ where: { id: sessionId } }).then((s) => s ? this.toSession(s) : undefined);
  }

  async listActiveSessions(projectId?: string): Promise<Session[]> {
    const where: Record<string, unknown> = { status: "ACTIVE" };
    if (projectId) where.projectId = projectId;

    const sessions = await this.prisma.session.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    return sessions.map((s) => this.toSession(s));
  }

  private toSession(raw: {
    id: string;
    name: string;
    projectId: string;
    workspaceId: string;
    status: string;
    conversation: unknown;
    toolCalls: unknown;
    plans: unknown;
    approvals: unknown;
    filesChanged: string[];
    checkpoints: string[];
    modelInfo: unknown;
    executionProvider: string;
    agentState: unknown;
    verification: unknown;
    deployment: unknown;
    memoryReferences: string[];
    forkedFrom: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Session {
    return {
      id: raw.id,
      name: raw.name,
      projectId: raw.projectId,
      workspaceId: raw.workspaceId,
      status: raw.status.toLowerCase() as SessionStatus,
      conversation: raw.conversation as ConversationMessage[],
      toolCalls: raw.toolCalls as ToolCallRecord[],
      plans: raw.plans as PlanRecord[],
      approvals: raw.approvals as ApprovalRecord[],
      filesChanged: raw.filesChanged,
      checkpoints: raw.checkpoints,
      modelInfo: raw.modelInfo as Session["modelInfo"],
      executionProvider: raw.executionProvider,
      agentState: raw.agentState as Session["agentState"],
      verification: raw.verification as Session["verification"],
      deployment: raw.deployment as Session["deployment"],
      memoryReferences: raw.memoryReferences,
      forkedFrom: raw.forkedFrom ?? undefined,
      archivedAt: raw.archivedAt ?? undefined,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
