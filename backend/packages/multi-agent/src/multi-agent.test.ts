import { describe, it, expect, beforeEach } from "vitest";
import { SupervisorAgent } from "./supervisor.js";
import { PlannerAgent } from "./planner.js";
import { CoderAgent } from "./coder.js";
import { ReviewerAgent } from "./reviewer.js";
import { TesterAgent } from "./tester.js";
import { DevOpsAgent } from "./devops.js";
import type { AgentTask } from "./types.js";

describe("Multi-Agent System", () => {
  let supervisor: SupervisorAgent;

  beforeEach(() => {
    supervisor = new SupervisorAgent();
    supervisor.registerAgent(new PlannerAgent());
    supervisor.registerAgent(new CoderAgent());
    supervisor.registerAgent(new ReviewerAgent());
    supervisor.registerAgent(new TesterAgent());
    supervisor.registerAgent(new DevOpsAgent());
  });

  describe("Supervisor", () => {
    it("should register agents", () => {
      const statuses = supervisor.getAllAgentStatuses();
      expect(statuses).toHaveLength(5);
    });

    it("should analyze task and determine required agents", () => {
      const task: AgentTask = {
        id: "1",
        role: "supervisor",
        description: "Create a new React component",
        input: {},
        output: null,
        status: "pending",
        dependencies: [],
      };

      const decision = supervisor.makeDecision(task);
      expect(decision.type).toBe("delegate");
      expect(decision.confidence).toBeGreaterThan(0);
    });

    it("should execute a coding task", async () => {
      const task: AgentTask = {
        id: "1",
        role: "supervisor",
        description: "Implement a new feature",
        input: { goal: "Create a login form" },
        output: null,
        status: "pending",
        dependencies: [],
      };

      const result = await supervisor.execute(task);
      expect(result.status).toBe("completed");
      expect(result.output).toBeDefined();
    });

    it("should handle messages from agents", async () => {
      const message = {
        id: "1",
        from: "coder" as const,
        to: "supervisor" as const,
        type: "observation" as const,
        content: "Task completed",
        metadata: {},
        timestamp: new Date(),
      };

      const response = await supervisor.handleMessage(message);
      expect(response.from).toBe("supervisor");
      expect(response.to).toBe("coder");
    });
  });

  describe("Planner Agent", () => {
    it("should decompose goals into steps", async () => {
      const planner = new PlannerAgent();
      const task: AgentTask = {
        id: "1",
        role: "planner",
        description: "Create a new feature",
        input: { goal: "Implement user authentication" },
        output: null,
        status: "pending",
        dependencies: [],
      };

      const result = await planner.execute(task);
      expect(result.status).toBe("completed");
      expect(result.output).toBeDefined();
      const output = result.output as { steps: unknown[] };
      expect(output.steps.length).toBeGreaterThan(0);
    });
  });

  describe("Coder Agent", () => {
    it("should analyze coding tasks", async () => {
      const coder = new CoderAgent();
      const task: AgentTask = {
        id: "1",
        role: "coder",
        description: "Fix a bug in the login component",
        input: {},
        output: null,
        status: "pending",
        dependencies: [],
      };

      const result = await coder.execute(task);
      expect(result.status).toBe("completed");
      const output = result.output as { analysis: { type: string } };
      expect(output.analysis.type).toBe("bugfix");
    });
  });

  describe("Reviewer Agent", () => {
    it("should review code and find issues", async () => {
      const reviewer = new ReviewerAgent();
      const task: AgentTask = {
        id: "1",
        role: "reviewer",
        description: "Review code quality",
        input: { code: 'function test() { eval("dangerous"); }' },
        output: null,
        status: "pending",
        dependencies: [],
      };

      const result = await reviewer.execute(task);
      expect(result.status).toBe("completed");
      const output = result.output as { issues: Array<{ severity: string }> };
      expect(output.issues.length).toBeGreaterThan(0);
      expect(output.issues.some((i) => i.severity === "critical")).toBe(true);
    });
  });

  describe("Tester Agent", () => {
    it("should generate and run tests", async () => {
      const tester = new TesterAgent();
      const task: AgentTask = {
        id: "1",
        role: "tester",
        description: "Run tests",
        input: { code: "function add(a, b) { return a + b; }" },
        output: null,
        status: "pending",
        dependencies: [],
      };

      const result = await tester.execute(task);
      expect(result.status).toBe("completed");
      const output = result.output as { testsGenerated: number; coverage: number };
      expect(output.testsGenerated).toBeGreaterThan(0);
      expect(output.coverage).toBeGreaterThanOrEqual(0);
    });
  });

  describe("DevOps Agent", () => {
    it("should handle deployment tasks", async () => {
      const devops = new DevOpsAgent();
      const task: AgentTask = {
        id: "1",
        role: "devops",
        description: "Deploy to production",
        input: { environment: "production" },
        output: null,
        status: "pending",
        dependencies: [],
      };

      const result = await devops.execute(task);
      expect(result.status).toBe("completed");
      const output = result.output as { action: string; url?: string };
      expect(output.action).toBe("deploy");
      expect(output.url).toBeDefined();
    });

    it("should handle rollback tasks", async () => {
      const devops = new DevOpsAgent();
      const task: AgentTask = {
        id: "1",
        role: "devops",
        description: "Rollback the last deployment",
        input: {},
        output: null,
        status: "pending",
        dependencies: [],
      };

      const result = await devops.execute(task);
      expect(result.status).toBe("completed");
      const output = result.output as { action: string; logs: string[] };
      expect(output.action).toBe("rollback");
      expect(output.logs.some((l) => l.includes("Rollback complete"))).toBe(true);
    });
  });

  describe("Agent Status", () => {
    it("should report status correctly", () => {
      const coder = new CoderAgent();
      const status = coder.getStatus();
      expect(status.role).toBe("coder");
      expect(status.status).toBe("idle");
      expect(status.currentTask).toBeNull();
      expect(status.completedTasks).toBe(0);
    });
  });
});
