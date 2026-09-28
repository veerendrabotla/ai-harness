import { describe, it, expect, beforeEach } from "vitest";
import { AgentModeManager } from "./mode-manager.js";
import { MODE_CONFIGS } from "./types.js";
import type { ModeContext } from "./types.js";

const testContext: ModeContext = {
  mode: "build",
  workspaceId: "ws-1",
  projectId: "proj-1",
  taskId: "task-1",
  userId: "user-1",
  userRole: "ADMIN",
  tokenBudget: 100_000,
  timeBudgetMs: 30 * 60 * 1000,
  currentIteration: 0,
  approvalRequired: false,
  filesChanged: [],
  commandsExecuted: [],
  errors: [],
};

describe("AgentModeManager", () => {
  let manager: AgentModeManager;

  beforeEach(() => {
    manager = new AgentModeManager();
  });

  describe("Initial State", () => {
    it("should start in build mode", () => {
      expect(manager.getMode()).toBe("build");
    });

    it("should have build mode config", () => {
      const config = manager.getConfig();
      expect(config.mode).toBe("build");
      expect(config.canModifyFiles).toBe(true);
      expect(config.canExecuteCommands).toBe(true);
    });
  });

  describe("Mode Configs", () => {
    it("should have all 5 modes", () => {
      expect(Object.keys(MODE_CONFIGS)).toHaveLength(5);
      expect(MODE_CONFIGS.build).toBeDefined();
      expect(MODE_CONFIGS.plan).toBeDefined();
      expect(MODE_CONFIGS.ask).toBeDefined();
      expect(MODE_CONFIGS.review).toBeDefined();
      expect(MODE_CONFIGS.fix).toBeDefined();
    });

    it("plan mode should not modify files", () => {
      expect(MODE_CONFIGS.plan.canModifyFiles).toBe(false);
      expect(MODE_CONFIGS.plan.canExecuteCommands).toBe(false);
    });

    it("ask mode should not modify files", () => {
      expect(MODE_CONFIGS.ask.canModifyFiles).toBe(false);
      expect(MODE_CONFIGS.ask.canExecuteCommands).toBe(false);
    });

    it("review mode should not modify files", () => {
      expect(MODE_CONFIGS.review.canModifyFiles).toBe(false);
      expect(MODE_CONFIGS.review.canExecuteCommands).toBe(false);
    });

    it("fix mode should modify files", () => {
      expect(MODE_CONFIGS.fix.canModifyFiles).toBe(true);
      expect(MODE_CONFIGS.fix.canExecuteCommands).toBe(true);
    });
  });

  describe("Transitions", () => {
    it("should allow transition from build to plan", () => {
      expect(manager.canTransition("build", "plan")).toBe(true);
    });

    it("should allow transition from build to ask", () => {
      expect(manager.canTransition("build", "ask")).toBe(true);
    });

    it("should allow transition from build to review", () => {
      expect(manager.canTransition("build", "review")).toBe(true);
    });

    it("should allow transition from build to fix", () => {
      expect(manager.canTransition("build", "fix")).toBe(true);
    });

    it("should require approval for plan to build", () => {
      expect(manager.requiresApproval("plan", "build")).toBe(true);
    });

    it("should require approval for ask to build", () => {
      expect(manager.requiresApproval("ask", "build")).toBe(true);
    });

    it("should require approval for review to build", () => {
      expect(manager.requiresApproval("review", "build")).toBe(true);
    });

    it("should not require approval for build to plan", () => {
      expect(manager.requiresApproval("build", "plan")).toBe(false);
    });
  });

  describe("Mode Switching", () => {
    it("should transition to plan mode", async () => {
      const result = await manager.transition("plan", testContext);
      expect(result.success).toBe(true);
      expect(manager.getMode()).toBe("plan");
    });

    it("should transition to ask mode", async () => {
      const result = await manager.transition("ask", testContext);
      expect(result.success).toBe(true);
      expect(manager.getMode()).toBe("ask");
    });

    it("should fail transition without approval when required", async () => {
      await manager.transition("plan", testContext);
      const result = await manager.transition("build", { ...testContext, mode: "plan" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("requires approval");
    });

    it("should succeed with approval", async () => {
      manager.approveTransition("plan", "build");
      await manager.transition("plan", testContext);

      const result = await manager.transition("build", { ...testContext, mode: "plan" });
      expect(result.success).toBe(true);
    });
  });

  describe("Tool Access", () => {
    it("should allow read_file in build mode", () => {
      expect(manager.validateToolAccess("read_file", "build")).toBe(true);
    });

    it("should allow write_file in build mode", () => {
      expect(manager.validateToolAccess("write_file", "build")).toBe(true);
    });

    it("should not allow write_file in plan mode", () => {
      expect(manager.validateToolAccess("write_file", "plan")).toBe(false);
    });

    it("should allow read_file in plan mode", () => {
      expect(manager.validateToolAccess("read_file", "plan")).toBe(true);
    });

    it("should not allow execute_command in plan mode", () => {
      expect(manager.validateToolAccess("execute_command", "plan")).toBe(false);
    });

    it("should get correct permission level", () => {
      expect(manager.getToolPermission("read_file", "build")).toBe("read");
      expect(manager.getToolPermission("write_file", "build")).toBe("write");
      expect(manager.getToolPermission("execute_command", "build")).toBe("execute");
    });
  });

  describe("Approval Requirements", () => {
    it("should require approval for git_commit in build mode", () => {
      expect(manager.requiresToolApproval("git_commit", "build")).toBe(true);
    });

    it("should require approval for install_dependency in build mode", () => {
      expect(manager.requiresToolApproval("install_dependency", "build")).toBe(true);
    });

    it("should not require approval for read_file in build mode", () => {
      expect(manager.requiresToolApproval("read_file", "build")).toBe(false);
    });
  });

  describe("History", () => {
    it("should track mode history", async () => {
      await manager.transition("plan", testContext);
      manager.approveTransition("plan", "build");
      await manager.transition("build", { ...testContext, mode: "plan" });

      const history = manager.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]!.mode).toBe("plan");
      expect(history[1]!.mode).toBe("build");
    });
  });

  describe("Available Transitions", () => {
    it("should list available transitions from build", () => {
      const transitions = manager.getAvailableTransitions();
      expect(transitions.length).toBe(4);
      expect(transitions.map((t) => t.to)).toContain("plan");
      expect(transitions.map((t) => t.to)).toContain("ask");
      expect(transitions.map((t) => t.to)).toContain("review");
      expect(transitions.map((t) => t.to)).toContain("fix");
    });
  });

  describe("Reset", () => {
    it("should reset to build mode", async () => {
      await manager.transition("plan", testContext);
      manager.reset();

      expect(manager.getMode()).toBe("build");
      expect(manager.getHistory().length).toBe(0);
    });
  });
});
