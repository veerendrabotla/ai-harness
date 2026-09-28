import { describe, it, expect, vi } from "vitest";
import { buildAgentRuntime } from "./runtime.js";

function createMockPrisma() {
  return {
    $transaction: vi.fn().mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return fn({
          taskEvent: {
            aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 0 } }),
            create: vi.fn().mockResolvedValue({}),
          },
        });
      }
      return {};
    }),
    task: { findUnique: vi.fn().mockResolvedValue(null) },
    taskRun: { findUnique: vi.fn().mockResolvedValue(null) },
    taskPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    checkpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    projectMemory: { findMany: vi.fn().mockResolvedValue([]) },
    taskEvent: {
      aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 0 } }),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe("AgentRuntime composition", () => {
  it("builds a complete runtime with all subsystems", () => {
    const runtime = buildAgentRuntime({
      prisma: createMockPrisma() as never,
      logger: createMockLogger() as never,
    });

    expect(runtime.orchestrator).toBeDefined();
    expect(runtime.memoryOrchestrator).toBeDefined();
    expect(runtime.multiAgentOrchestrator).toBeDefined();
    expect(runtime.approvals).toBeDefined();
    expect(runtime.events).toBeDefined();
    expect(runtime.tools).toBeDefined();
    expect(runtime.harness).toBeDefined();
    expect(runtime.adapters).toBeDefined();
    expect(runtime.router).toBeDefined();
    expect(runtime.planner).toBeDefined();
    expect(runtime.checkpoints).toBeDefined();
    expect(runtime.verification).toBeDefined();
    expect(runtime.memoryEngine).toBeDefined();
    expect(runtime.sessionEngine).toBeDefined();
    expect(runtime.traceCollector).toBeDefined();
    expect(runtime.tracePersistence).toBeDefined();
    expect(runtime.communication).toBeDefined();
  });

  it("has all required tool definitions", () => {
    const runtime = buildAgentRuntime({
      prisma: createMockPrisma() as never,
      logger: createMockLogger() as never,
    });

    const toolNames = runtime.tools.list().map((t) => t.name);
    expect(toolNames).toContain("filesystem.read");
    expect(toolNames).toContain("filesystem.write");
    expect(toolNames).toContain("terminal.run");
    expect(toolNames).toContain("git.status");
    expect(toolNames).toContain("git.commit");
  });

  it("has all model adapters registered", () => {
    const runtime = buildAgentRuntime({
      prisma: createMockPrisma() as never,
      logger: createMockLogger() as never,
    });

    const anthropic = runtime.adapters.get("ANTHROPIC");
    const openai = runtime.adapters.get("OPENAI");
    const google = runtime.adapters.get("GOOGLE");
    const ollama = runtime.adapters.get("OLLAMA");

    expect(anthropic).toBeDefined();
    expect(openai).toBeDefined();
    expect(google).toBeDefined();
    expect(ollama).toBeDefined();
  });

  it("has model runtime with all providers", () => {
    const runtime = buildAgentRuntime({
      prisma: createMockPrisma() as never,
      logger: createMockLogger() as never,
    });

    expect(runtime.modelRuntime).toBeDefined();
    const providers = runtime.modelRuntime.listProviders();
    expect(providers).toContain("ANTHROPIC");
    expect(providers).toContain("OPENAI");
    expect(providers).toContain("GOOGLE");
    expect(providers).toContain("OLLAMA");
  });
});
