import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryProjectMemoryEngine } from "@ai-harness/project-memory";
import { InMemoryAgentCommunication } from "./agent-communication.js";

describe("Memory-Aware Orchestrator Integration", () => {
  let memoryEngine: InMemoryProjectMemoryEngine;

  beforeEach(() => {
    memoryEngine = new InMemoryProjectMemoryEngine();
    memoryEngine.clearAll();
  });

  it("should store and retrieve project memories", async () => {
    await memoryEngine.remember("project-1", {
      projectId: "project-1",
      category: "architecture_decision",
      key: "use-react",
      value: "Use React with TypeScript",
      context: "Frontend framework choice",
      confidence: 0.9,
      source: "user_input",
      references: [],
    });

    const insights = await memoryEngine.getRelevant("project-1", "What framework should I use?");
    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0]!.memory.value).toContain("React");
  });

  it("should retrieve memories by category", async () => {
    await memoryEngine.remember("project-1", {
      projectId: "project-1",
      category: "coding_convention",
      key: "use-eslint",
      value: "Use ESLint with airbnb config",
      context: "",
      confidence: 0.8,
      source: "code_analysis",
      references: [],
    });

    const results = await memoryEngine.query({
      projectId: "project-1",
      category: "coding_convention",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("coding_convention");
  });

  it("should reinforce memory confidence", async () => {
    const memory = await memoryEngine.remember("project-1", {
      projectId: "project-1",
      category: "lesson_learned",
      key: "always-test",
      value: "Always run tests before committing",
      context: "",
      confidence: 0.5,
      source: "agent_observation",
      references: [],
    });

    await memoryEngine.reinforce(memory.id, "Verified in 5 runs");

    const updated = await memoryEngine.query({ projectId: "project-1" });
    expect(updated[0]!.confidence).toBeGreaterThan(0.5);
  });

  it("should get memory statistics", async () => {
    await memoryEngine.remember("project-1", {
      projectId: "project-1",
      category: "architecture_decision",
      key: "use-react",
      value: "Use React",
      context: "",
      confidence: 0.9,
      source: "user_input",
      references: [],
    });

    const stats = await memoryEngine.stats("project-1");
    expect(stats.total).toBe(1);
    expect(stats.byCategory.architecture_decision).toBe(1);
  });
});

describe("Agent Communication Integration", () => {
  let communication: InMemoryAgentCommunication;

  beforeEach(() => {
    communication = new InMemoryAgentCommunication();
  });

  it("should send and receive messages between agents", async () => {
    const message = await communication.sendMessage({
      from: "planner",
      to: "coder",
      type: "delegation",
      content: "Implement the login form",
      metadata: { taskId: "task-1" },
    });

    expect(message.id).toBeDefined();
    expect(message.from).toBe("planner");
    expect(message.to).toBe("coder");

    const messages = await communication.getMessagesForAgent("coder", "task-1");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("Implement the login form");
  });

  it("should share artifacts between agents", async () => {
    const artifact = await communication.shareArtifact({
      type: "code",
      name: "Login.tsx",
      content: "export function Login() { ... }",
      metadata: { taskId: "task-1" },
      createdBy: "coder",
    });

    expect(artifact.id).toBeDefined();
    expect(artifact.type).toBe("code");
    expect(artifact.name).toBe("Login.tsx");

    const artifacts = await communication.getTaskArtifacts("task-1");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.name).toBe("Login.tsx");
  });

  it("should record decisions", async () => {
    await communication.recordDecision(
      "coder",
      "Use React Hook Form",
      "More maintainable than manual state",
      "task-1",
    );

    const decisions = await communication.getTaskDecisions("task-1");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("Use React Hook Form");
    expect(decisions[0]!.agent).toBe("coder");
  });

  it("should report and resolve blockers", async () => {
    await communication.reportBlocker(
      "coder",
      "Cannot access database",
      "task-1",
    );

    const context = await communication.getTaskContext("task-1");
    expect(context.blockers).toHaveLength(1);
    expect(context.blockers[0]!.resolved).toBe(false);

    // Resolve the blocker
    await communication.resolveBlocker(context.blockers[0]!.id, "task-1");

    const updatedContext = await communication.getTaskContext("task-1");
    expect(updatedContext.blockers[0]!.resolved).toBe(true);
  });

  it("should get full task context", async () => {
    await communication.sendMessage({
      from: "planner",
      to: "coder",
      type: "delegation",
      content: "Implement feature",
      metadata: { taskId: "task-1" },
    });

    await communication.shareArtifact({
      type: "design",
      name: "Architecture",
      content: "Use microservices",
      metadata: { taskId: "task-1" },
      createdBy: "planner",
    });

    await communication.recordDecision(
      "planner",
      "Use microservices",
      "Better scalability",
      "task-1",
    );

    const context = await communication.getTaskContext("task-1");
    expect(context.messages).toHaveLength(1);
    expect(context.artifacts).toHaveLength(1);
    expect(context.decisions).toHaveLength(1);
  });
});
