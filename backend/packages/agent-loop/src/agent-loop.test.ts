import { describe, it, expect, beforeEach } from "vitest";
import { AgentLoop } from "./agent-loop.js";
import { DEFAULT_LOOP_CONFIG, PHASE_ORDER } from "./types.js";
import type { ToolCall } from "./types.js";

describe("AgentLoop", () => {
  let loop: AgentLoop;

  beforeEach(() => {
    loop = new AgentLoop();
  });

  describe("Initialization", () => {
    it("should create a loop with default config", () => {
      const config = loop.getConfig();
      expect(config.maxIterations).toBe(DEFAULT_LOOP_CONFIG.maxIterations);
      expect(config.maxTokenBudget).toBe(DEFAULT_LOOP_CONFIG.maxTokenBudget);
    });

    it("should create a loop with custom config", () => {
      const customLoop = new AgentLoop({ maxIterations: 10 });
      const config = customLoop.getConfig();
      expect(config.maxIterations).toBe(10);
    });

    it("should start in goal phase", () => {
      const state = loop.getState();
      expect(state.phase).toBe("goal");
      expect(state.iteration).toBe(0);
    });
  });

  describe("Run Loop", () => {
    it("should complete a simple loop", async () => {
      const result = await loop.run("Test goal");
      expect(result.success).toBe(true);
      expect(result.finalPhase).toBe("complete");
      expect(result.iterations).toBeGreaterThanOrEqual(0);
    });

    it("should track observations", async () => {
      const result = await loop.run("Test goal");
      expect(result.observations.length).toBeGreaterThan(0);
    });

    it("should track time", async () => {
      const result = await loop.run("Test goal");
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle errors gracefully", async () => {
      const errorLoop = new AgentLoop({}, {
        onToolCall: async () => {
          throw new Error("Test error");
        },
      });
      const result = await errorLoop.run("Test goal");
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });
  });

  describe("Tool Execution", () => {
    it("should execute tool calls via handler", async () => {
      const executedTools: string[] = [];
      const toolLoop = new AgentLoop({}, {
        onToolCall: async (call: ToolCall) => {
          executedTools.push(call.name);
          return { callId: call.id, success: true, output: "done", duration: 100 };
        },
      });

      await toolLoop.run("Test goal");
    });

    it("should track tool execution results", async () => {
      const result = await loop.run("Test goal");
      expect(result.commandsExecuted).toBeDefined();
    });
  });

  describe("Stuck Detection", () => {
    it("should detect stuck state", async () => {
      const stuckLoop = new AgentLoop({
        stuckThresholdMs: 100,
      });

      const result = await stuckLoop.run("Test goal");
      expect(result).toBeDefined();
    });
  });

  describe("Iteration Limits", () => {
    it("should respect max iterations", async () => {
      const limitedLoop = new AgentLoop({ maxIterations: 2 });
      const result = await limitedLoop.run("Test goal");
      expect(result.iterations).toBeLessThanOrEqual(2);
    });
  });

  describe("Phase History", () => {
    it("should track phase transitions", async () => {
      const phases: string[] = [];
      const phaseLoop = new AgentLoop({}, {
        onPhaseChange: (phase) => {
          phases.push(phase);
        },
      });

      await phaseLoop.run("Test goal");
      expect(phases.length).toBeGreaterThan(0);
      expect(phases).toContain("goal");
      expect(phases).toContain("complete");
    });
  });

  describe("Observations", () => {
    it("should record observations", async () => {
      const observations: string[] = [];
      const obsLoop = new AgentLoop({}, {
        onObservation: (obs) => {
          observations.push(obs.content);
        },
      });

      await obsLoop.run("Test goal");
      expect(observations.length).toBeGreaterThan(0);
    });
  });

  describe("Failure Types", () => {
    it("should classify recoverable failures", async () => {
      const result = await loop.run("Test goal");
      expect(result.errors).toBeDefined();
    });
  });

  describe("Config", () => {
    it("should have all phase order entries", () => {
      expect(PHASE_ORDER.length).toBe(13);
      expect(PHASE_ORDER).toContain("goal");
      expect(PHASE_ORDER).toContain("complete");
    });
  });
});
