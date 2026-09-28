import { describe, it, expect } from "vitest";
import { agentModeSchema, AGENT_MODES } from "../src/enums.js";

describe("AgentMode enum", () => {
  it("defines all five modes", () => {
    expect(AGENT_MODES).toEqual(["BUILD", "PLAN", "ASK", "REVIEW", "FIX"]);
  });

  it("validates each mode", () => {
    for (const mode of AGENT_MODES) {
      expect(agentModeSchema.parse(mode)).toBe(mode);
    }
  });

  it("rejects invalid modes", () => {
    expect(() => agentModeSchema.parse("INVALID")).toThrow();
    expect(() => agentModeSchema.parse("build")).toThrow();
    expect(() => agentModeSchema.parse("")).toThrow();
    expect(() => agentModeSchema.parse(null)).toThrow();
  });
});

describe("AgentMode type safety", () => {
  it("defaults to BUILD in task creation schema", async () => {
    const { createTaskRequestSchema } = await import("../src/tasks.js");
    const result = createTaskRequestSchema.parse({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      projectId: "00000000-0000-0000-0000-000000000002",
      goal: "Build a hello world app",
    });
    expect(result.agentMode).toBe("BUILD");
  });

  it("accepts all valid agent modes", async () => {
    const { createTaskRequestSchema } = await import("../src/tasks.js");
    for (const mode of AGENT_MODES) {
      const result = createTaskRequestSchema.parse({
        workspaceId: "00000000-0000-0000-0000-000000000001",
        projectId: "00000000-0000-0000-0000-000000000002",
        goal: "Test task",
        agentMode: mode,
      });
      expect(result.agentMode).toBe(mode);
    }
  });

  it("rejects invalid agent mode in task creation", async () => {
    const { createTaskRequestSchema } = await import("../src/tasks.js");
    expect(() => createTaskRequestSchema.parse({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      projectId: "00000000-0000-0000-0000-000000000002",
      goal: "Test",
      agentMode: "INVALID",
    })).toThrow();
  });
});
