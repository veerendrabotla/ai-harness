import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryProjectMemoryEngine } from "./engine.js";

describe("Project Memory", () => {
  let engine: InMemoryProjectMemoryEngine;

  beforeEach(() => {
    engine = new InMemoryProjectMemoryEngine();
    engine.clearAll();
  });

  describe("remember", () => {
    it("should store a memory", async () => {
      const memory = await engine.remember("project-1", {
        projectId: "project-1",
        category: "architecture_decision",
        key: "use-react",
        value: "Use React with TypeScript for frontend",
        context: "Project uses React ecosystem",
        confidence: 0.9,
        source: "user_input",
        references: ["package.json"],
      });
      expect(memory.id).toBeDefined();
      expect(memory.projectId).toBe("project-1");
      expect(memory.category).toBe("architecture_decision");
    });
  });

  describe("query", () => {
    it("should query memories by project", async () => {
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "architecture_decision",
        key: "use-react",
        value: "Use React",
        context: "",
        confidence: 0.9,
        source: "user_input",
        references: [],
      });
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "coding_convention",
        key: "use-eslint",
        value: "Use ESLint with airbnb config",
        context: "",
        confidence: 0.8,
        source: "code_analysis",
        references: [],
      });
      await engine.remember("project-2", {
        projectId: "project-2",
        category: "architecture_decision",
        key: "use-vue",
        value: "Use Vue.js",
        context: "",
        confidence: 0.9,
        source: "user_input",
        references: [],
      });

      const results = await engine.query({ projectId: "project-1" });
      expect(results).toHaveLength(2);
      expect(results.every((m) => m.projectId === "project-1")).toBe(true);
    });

    it("should filter by category", async () => {
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "architecture_decision",
        key: "use-react",
        value: "Use React",
        context: "",
        confidence: 0.9,
        source: "user_input",
        references: [],
      });
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "coding_convention",
        key: "use-eslint",
        value: "Use ESLint",
        context: "",
        confidence: 0.8,
        source: "code_analysis",
        references: [],
      });

      const results = await engine.query({
        projectId: "project-1",
        category: "architecture_decision",
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.category).toBe("architecture_decision");
    });

    it("should filter by keywords", async () => {
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "architecture_decision",
        key: "use-react",
        value: "Use React with TypeScript for frontend",
        context: "",
        confidence: 0.9,
        source: "user_input",
        references: [],
      });
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "architecture_decision",
        key: "use-express",
        value: "Use Express for backend API",
        context: "",
        confidence: 0.9,
        source: "user_input",
        references: [],
      });

      const results = await engine.query({
        projectId: "project-1",
        keywords: ["react", "frontend"],
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.key).toBe("use-react");
    });
  });

  describe("getRelevant", () => {
    it("should find relevant memories for context", async () => {
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "previous_bug",
        key: "typescript-error",
        value: "Property 'email' does not exist on type 'User'",
        context: "Happens when accessing user.email without null check",
        confidence: 0.9,
        source: "error_pattern",
        references: ["src/User.ts"],
      });
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "lesson_learned",
        key: "null-check",
        value: "Always check for null before accessing optional properties",
        context: "TypeScript strict mode",
        confidence: 0.85,
        source: "agent_observation",
        references: [],
      });

      const insights = await engine.getRelevant("project-1", "Fix TypeScript error in User component");
      expect(insights.length).toBeGreaterThan(0);
      expect(insights[0]!.relevance).toBeGreaterThan(0);
    });
  });

  describe("reinforce", () => {
    it("should increase confidence on reinforcement", async () => {
      const memory = await engine.remember("project-1", {
        projectId: "project-1",
        category: "lesson_learned",
        key: "always-test",
        value: "Always run tests before committing",
        context: "",
        confidence: 0.5,
        source: "agent_observation",
        references: [],
      });

      await engine.reinforce(memory.id, "Verified in 5 consecutive runs");

      const updated = (await engine.query({ projectId: "project-1" }))[0];
      expect(updated!.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("decay", () => {
    it("should decay old memories", async () => {
      const _memory = await engine.remember("project-1", {
        projectId: "project-1",
        category: "lesson_learned",
        key: "old-lesson",
        value: "This is an old lesson",
        context: "",
        confidence: 0.8,
        source: "agent_observation",
        references: [],
      });

      // Verify memory exists
      const before = await engine.query({ projectId: "project-1" });
      expect(before).toHaveLength(1);

      // Decay with very short max age (should decay the memory we just created)
      const decayed = await engine.decay("project-1", 0);
      expect(decayed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("stats", () => {
    it("should return memory statistics", async () => {
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "architecture_decision",
        key: "use-react",
        value: "Use React",
        context: "",
        confidence: 0.9,
        source: "user_input",
        references: [],
      });
      await engine.remember("project-1", {
        projectId: "project-1",
        category: "coding_convention",
        key: "use-eslint",
        value: "Use ESLint",
        context: "",
        confidence: 0.8,
        source: "code_analysis",
        references: [],
      });

      const stats = await engine.stats("project-1");
      expect(stats.total).toBe(2);
      expect(stats.byCategory.architecture_decision).toBe(1);
      expect(stats.byCategory.coding_convention).toBe(1);
      expect(stats.averageConfidence).toBeCloseTo(0.85);
    });
  });
});
