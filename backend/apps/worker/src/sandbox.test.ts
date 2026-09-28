import { describe, it, expect } from "vitest";
import { ensureEnvLoaded } from "@ai-harness/shared";
import type { PrismaClient } from "@ai-harness/database";
import type { ToolDefinition, ExecutionEnvironmentResolver } from "@ai-harness/tool-harness";
import { z } from "zod";
import { buildCompositeResolver } from "./sandbox.js";

ensureEnvLoaded();

interface StubServer {
  id: string;
  status: string;
  transportType: string;
  ownerId: string;
  encryptedConfig: Buffer;
}

function stubPrisma(server: StubServer | null): PrismaClient {
  return {
    mcpServer: {
      findUnique: async () => server,
    },
    task: {
      findUnique: async () => ({ createdBy: "user-1", workspaceId: "ws-1" }),
    },
    bridge: {
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;
}

function makeServer(status: string, transportType: string): StubServer {
  return {
    id: "server-1",
    status,
    transportType,
    ownerId: "owner-1",
    encryptedConfig: Buffer.from("not-a-real-config"),
  };
}

const MCP_DEF: ToolDefinition = {
  name: "mcp.call",
  description: "Invoke an MCP tool",
  riskLevel: "EXTERNAL",
  inputSchema: z.object({}),
  resultSchema: z.unknown(),
  timeoutMs: 5000,
  outputLimitBytes: 100_000,
  environment: "INTERNAL",
};

async function callMcp(
  server: StubServer | null,
): Promise<Promise<unknown>> {
  const resolver: ExecutionEnvironmentResolver = buildCompositeResolver(
    stubPrisma(server),
    undefined,
  );
  const executor = await resolver.resolve("INTERNAL", MCP_DEF);
  return executor(
    { serverId: "server-1", mcpToolName: "tool", args: {} },
    undefined as unknown as AbortSignal,
    { taskId: "task-1", runId: "run-1" },
  );
}

describe("F-13: disabled MCP servers cannot receive calls", () => {
  it("rejects a disabled STDIO server before touching the bridge", async () => {
    // ACTIVE STDIO with no connected bridge would fail with BRIDGE_DISCONNECTED;
    // a disabled server must fail earlier with POLICY_DENIED.
    await expect(callMcp(makeServer("DISABLED", "STDIO"))).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
  });

  it("rejects a disabled HTTP server with POLICY_DENIED", async () => {
    await expect(callMcp(makeServer("DISABLED", "HTTP"))).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
  });

  it("an ACTIVE STDIO server proceeds past the status check (fails on missing bridge)", async () => {
    await expect(callMcp(makeServer("ACTIVE", "STDIO"))).rejects.toMatchObject({
      message: expect.stringContaining("connected Local Bridge"),
    });
  });

  it("rejects an unknown server with NOT_FOUND", async () => {
    await expect(callMcp(null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
