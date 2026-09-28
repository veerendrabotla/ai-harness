import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaSessionEngine } from "./prisma-engine.js";

function createMockPrisma() {
  return {
    session: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: "session-1",
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(async ({ data }) => ({
        id: "session-1",
        name: "Test Session",
        projectId: "proj-1",
        workspaceId: "ws-1",
        status: data.status || "ACTIVE",
        conversation: data.conversation || [],
        toolCalls: data.toolCalls || [],
        plans: data.plans || [],
        approvals: data.approvals || [],
        filesChanged: data.filesChanged || [],
        checkpoints: data.checkpoints || [],
        modelInfo: data.modelInfo || {},
        executionProvider: data.executionProvider || "unknown",
        agentState: data.agentState || {},
        verification: data.verification || {},
        deployment: data.deployment || null,
        memoryReferences: data.memoryReferences || [],
        forkedFrom: data.forkedFrom || null,
        archivedAt: data.archivedAt || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("PrismaSessionEngine", () => {
  let engine: PrismaSessionEngine;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    engine = new PrismaSessionEngine(mockPrisma as never);
  });

  it("creates a session", async () => {
    const session = await engine.createSession({
      name: "Test Session",
      projectId: "proj-1",
      workspaceId: "ws-1",
    });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.name).toBe("Test Session");
    expect(session.status).toBe("active");
    expect(mockPrisma.session.create).toHaveBeenCalled();
  });

  it("resumes a session", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce({
      id: "session-1",
      name: "Test Session",
      projectId: "proj-1",
      workspaceId: "ws-1",
      status: "PAUSED",
      conversation: [],
      toolCalls: [],
      plans: [],
      approvals: [],
      filesChanged: [],
      checkpoints: [],
      modelInfo: {},
      executionProvider: "unknown",
      agentState: {},
      verification: {},
      deployment: null,
      memoryReferences: [],
      forkedFrom: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const session = await engine.resumeSession("session-1");
    expect(session).toBeDefined();
    expect(session?.status).toBe("active");
  });

  it("forks a session", async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce({
      id: "session-1",
      name: "Original Session",
      projectId: "proj-1",
      workspaceId: "ws-1",
      status: "active",
      conversation: [{ id: "msg-1", role: "user", content: "Hello", timestamp: new Date() }],
      toolCalls: [],
      plans: [],
      approvals: [],
      filesChanged: [],
      checkpoints: [],
      modelInfo: { provider: "openai", model: "gpt-4", tokensUsed: 100 },
      executionProvider: "local",
      agentState: { mode: "build", phase: "idle", iteration: 0 },
      verification: { passed: false, tests: [] },
      deployment: null,
      memoryReferences: [],
      forkedFrom: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await engine.forkSession("session-1", "Forked Session");
    expect(result).toBeDefined();
    expect(result?.originalSessionId).toBe("session-1");
    expect(result?.newSessionId).toBeDefined();
    expect(result?.forkPoint).toBe(1);
  });

  it("searches sessions", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([]);

    const sessions = await engine.searchSessions({
      projectId: "proj-1",
      status: "active",
      limit: 10,
    });

    expect(sessions).toEqual([]);
    expect(mockPrisma.session.findMany).toHaveBeenCalled();
  });
});
