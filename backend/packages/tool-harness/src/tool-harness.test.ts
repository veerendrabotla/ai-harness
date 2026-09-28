import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./registry.js";
import { createDefaultToolRegistry } from "./definitions.js";
import { ToolHarness } from "./harness.js";
import { createLogger } from "@ai-harness/shared";
import { z } from "zod";
import type { ToolDefinition } from "./types.js";

describe("tool registry", () => {
  it("registers the full V1 tool set from AGENT_RUNTIME.md §11", () => {
    const registry = createDefaultToolRegistry();
    const names = registry.list().map((t) => t.name);
    for (const expected of [
      "filesystem.list",
      "filesystem.read",
      "filesystem.search",
      "git.status",
      "git.diff",
      "terminal.run_readonly",
      "filesystem.write",
      "filesystem.create",
      "filesystem.rename",
      "filesystem.delete",
      "terminal.run",
      "checkpoint.create",
      "checkpoint.rollback",
      "mcp.call",
      "http.request",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("assigns documented risk levels", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.require("filesystem.read").riskLevel).toBe("READ");
    expect(registry.require("filesystem.write").riskLevel).toBe("WRITE");
    expect(registry.require("filesystem.delete").riskLevel).toBe("DESTRUCTIVE");
    expect(registry.require("http.request").riskLevel).toBe("EXTERNAL");
  });

  it("refuses duplicate registration and unknown lookups", () => {
    const registry = new ToolRegistry();
    const def: ToolDefinition = {
      name: "x.y",
      description: "",
      riskLevel: "READ",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
      resultSchema: {} as never,
      timeoutMs: 1000,
      outputLimitBytes: 1000,
      environment: "INTERNAL",
    };
    registry.register(def);
    expect(() => registry.register(def)).toThrow();
    expect(registry.get("missing")).toBeUndefined();
  });

  it("supports dynamic tool registration and unregistration", () => {
    const registry = new ToolRegistry();
    const dynamicDef: ToolDefinition = {
      name: "ext.custom",
      description: "Custom extension tool",
      riskLevel: "READ",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
      resultSchema: {} as never,
      timeoutMs: 1000,
      outputLimitBytes: 1000,
      environment: "INTERNAL",
    };

    registry.registerDynamic(dynamicDef);
    expect(registry.get("ext.custom")).toBeDefined();
    expect(registry.list()).toHaveLength(1);

    const removed = registry.unregisterDynamic("ext.custom");
    expect(removed).toBe(true);
    expect(registry.get("ext.custom")).toBeUndefined();
  });

  it("lists tools by category", () => {
    const registry = createDefaultToolRegistry();
    const fsTools = registry.listByCategory("filesystem");
    expect(fsTools.length).toBeGreaterThan(0);
    expect(fsTools.every((t) => t.name.startsWith("filesystem."))).toBe(true);
  });

  it("lists tools by risk level", () => {
    const registry = createDefaultToolRegistry();
    const readTools = registry.listByRisk("READ");
    expect(readTools.length).toBeGreaterThan(0);
    expect(readTools.every((t) => t.riskLevel === "READ")).toBe(true);
  });

  it("returns tool names for model consumption", () => {
    const registry = createDefaultToolRegistry();
    const names = registry.getToolNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("filesystem.read");
  });

  it("returns tool descriptions for model consumption", () => {
    const registry = createDefaultToolRegistry();
    const descriptions = registry.getToolDescriptions();
    expect(descriptions.length).toBeGreaterThan(0);
    expect(descriptions[0]).toHaveProperty("name");
    expect(descriptions[0]).toHaveProperty("description");
    expect(descriptions[0]).toHaveProperty("riskLevel");
  });
});

describe("tool harness", () => {
  const logger = createLogger({ level: "error" });

  function harnessWith(registry: ToolRegistry) {
    return new ToolHarness(registry, null, logger);
  }

  it("rejects unknown tools with a structured failure", async () => {
    const result = await harnessWith(createDefaultToolRegistry()).execute({
      toolCallId: "tc1",
      taskId: "t1",
      runId: "r1",
      toolName: "does.not.exist",
      input: {},
    });
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("TOOL_NOT_FOUND");
    expect(result.classification).toBe("non_retryable");
  });

  it("validates input against the tool schema before execution", async () => {
    const result = await harnessWith(createDefaultToolRegistry()).execute({
      toolCallId: "tc2",
      taskId: "t1",
      runId: "r1",
      toolName: "filesystem.read",
      input: { path: 42 },
    });
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("VALIDATION_ERROR");
  });

  it("returns an environment-related failure when no execution environment exists (honest behavior)", async () => {
    const result = await harnessWith(createDefaultToolRegistry()).execute({
      toolCallId: "tc3",
      taskId: "t1",
      runId: "r1",
      toolName: "filesystem.read",
      input: { root: "/project", path: "src/index.ts" },
    });
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("EXECUTION_ENVIRONMENT_UNAVAILABLE");
    expect(result.classification).toBe("environment_related");
  });

  it("enforces timeouts when a resolver hangs", async () => {
    const slowTool: ToolDefinition = {
      name: "slow.tool",
      description: "",
      riskLevel: "READ",
      inputSchema: z.object({}),
      resultSchema: z.record(z.unknown()),
      timeoutMs: 50,
      outputLimitBytes: 10_000,
      environment: "INTERNAL",
    };
    const registry = new ToolRegistry();
    registry.register(slowTool);
    const resolver = {
      resolve: async () => async () => new Promise((resolve) => setTimeout(resolve, 5000)),
    };
    const harness = new ToolHarness(registry, resolver, logger);
    const result = await harness.execute({
      toolCallId: "tc4",
      taskId: "t1",
      runId: "r1",
      toolName: "slow.tool",
      input: {},
    });
    expect(result.status).toBe("TIMED_OUT");
    expect(result.classification).toBe("retryable");
  });

  it("truncates oversized output to the configured limit", async () => {
    const bigTool: ToolDefinition = {
      name: "big.tool",
      description: "",
      riskLevel: "READ",
      inputSchema: z.object({}),
      resultSchema: z.record(z.unknown()),
      timeoutMs: 2000,
      outputLimitBytes: 200,
      environment: "INTERNAL",
    };
    const registry = new ToolRegistry();
    registry.register(bigTool);
    const resolver = {
      resolve: async () => async () => ({ blob: "x".repeat(10_000) }),
    };
    const harness = new ToolHarness(registry, resolver, logger);
    const result = await harness.execute({
      toolCallId: "tc5",
      taskId: "t1",
      runId: "r1",
      toolName: "big.tool",
      input: {},
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.output?.["truncated"]).toBe(true);
  });

  it("returns CANCELLED when an external signal aborts mid-execution", async () => {
    const slowTool: ToolDefinition = {
      name: "slow2.tool",
      description: "",
      riskLevel: "READ",
      inputSchema: z.object({}),
      resultSchema: z.record(z.unknown()),
      timeoutMs: 30_000,
      outputLimitBytes: 10_000,
      environment: "INTERNAL",
    };
    const registry = new ToolRegistry();
    registry.register(slowTool);
    const resolver = {
      resolve: async () => async () => new Promise((resolve) => setTimeout(() => resolve({}), 5000)),
    };
    const harness = new ToolHarness(registry, resolver, logger);
    const external = new AbortController();
    setTimeout(() => external.abort(), 40);
    const result = await harness.execute(
      { toolCallId: "tc6", taskId: "t1", runId: "r1", toolName: "slow2.tool", input: {} },
      external.signal,
    );
    expect(result.status).toBe("CANCELLED");
    expect(result.classification).toBe("cancelled");
  });
});
