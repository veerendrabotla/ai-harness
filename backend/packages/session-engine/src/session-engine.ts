import { randomUUID } from "node:crypto";
import type {
  Session,
  SessionStatus,
  ConversationMessage,
  ToolCallRecord,
  PlanRecord,
  SessionForkResult,
} from "./types.js";

export class SessionEngine {
  private sessions = new Map<string, Session>();

  async createSession(config: {
    name: string;
    projectId: string;
    workspaceId: string;
    model?: string;
    provider?: string;
  }): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      name: config.name,
      projectId: config.projectId,
      workspaceId: config.workspaceId,
      status: "active",
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async resumeSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.status === "deleted") return null;

    session.status = "active";
    session.updatedAt = new Date();
    return session;
  }

  async pauseSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return false;

    session.status = "paused";
    session.updatedAt = new Date();
    return true;
  }

  async forkSession(sessionId: string, name?: string): Promise<SessionForkResult | null> {
    const original = this.sessions.get(sessionId);
    if (!original) return null;

    const forked: Session = {
      ...JSON.parse(JSON.stringify(original)),
      id: randomUUID(),
      name: name || `${original.name} (fork)`,
      status: "active",
      forkedFrom: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(forked.id, forked);

    return {
      originalSessionId: sessionId,
      newSessionId: forked.id,
      forkPoint: original.conversation.length,
    };
  }

  async cloneSession(sessionId: string, name?: string): Promise<Session | null> {
    const original = this.sessions.get(sessionId);
    if (!original) return null;

    const cloned: Session = {
      ...JSON.parse(JSON.stringify(original)),
      id: randomUUID(),
      name: name || `${original.name} (clone)`,
      status: "active",
      forkedFrom: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(cloned.id, cloned);
    return cloned;
  }

  async exportSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return JSON.parse(JSON.stringify(session));
  }

  async importSession(data: Session): Promise<Session> {
    const session: Session = {
      ...data,
      id: randomUUID(),
      status: "active",
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = "archived";
    session.archivedAt = new Date();
    session.updatedAt = new Date();
    return true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = "deleted";
    session.updatedAt = new Date();
    return true;
  }

  async restoreSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "deleted") return false;

    session.status = "active";
    session.updatedAt = new Date();
    session.archivedAt = undefined;
    return true;
  }

  async addMessage(sessionId: string, message: Omit<ConversationMessage, "id" | "timestamp">): Promise<ConversationMessage | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return null;

    const msg: ConversationMessage = {
      id: randomUUID(),
      ...message,
      timestamp: new Date(),
    };

    session.conversation.push(msg);
    session.updatedAt = new Date();
    return msg;
  }

  async addToolCall(sessionId: string, call: Omit<ToolCallRecord, "id" | "timestamp">): Promise<ToolCallRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return null;

    const record: ToolCallRecord = {
      id: randomUUID(),
      ...call,
      timestamp: new Date(),
    };

    session.toolCalls.push(record);
    session.updatedAt = new Date();
    return record;
  }

  async addPlan(sessionId: string, plan: Omit<PlanRecord, "id" | "timestamp">): Promise<PlanRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return null;

    const record: PlanRecord = {
      id: randomUUID(),
      ...plan,
      timestamp: new Date(),
    };

    session.plans.push(record);
    session.updatedAt = new Date();
    return record;
  }

  async approvePlan(sessionId: string, planId: string, approvedBy: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const plan = session.plans.find((p) => p.id === planId);
    if (!plan) return false;

    plan.approved = true;
    plan.approvedBy = approvedBy;
    session.updatedAt = new Date();
    return true;
  }

  async searchSessions(query: {
    projectId?: string;
    workspaceId?: string;
    status?: SessionStatus;
    limit?: number;
  }): Promise<Session[]> {
    let results = Array.from(this.sessions.values());

    if (query.projectId) {
      results = results.filter((s) => s.projectId === query.projectId);
    }
    if (query.workspaceId) {
      results = results.filter((s) => s.workspaceId === query.workspaceId);
    }
    if (query.status) {
      results = results.filter((s) => s.status === query.status);
    }

    results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  listActiveSessions(projectId?: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.status === "active" && (!projectId || s.projectId === projectId));
  }
}
