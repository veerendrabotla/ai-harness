/**
 * Coder Agent.
 * Writes and modifies code.
 */
import { BaseAgent } from "./base-agent.js";
import type { AgentTask } from "./types.js";

export class CoderAgent extends BaseAgent {
  constructor() {
    super("coder", "Coder", "Writes and modifies code");
    this.capabilities = ["coding", "refactoring", "debugging", "implementation"];
  }

  async execute(task: AgentTask): Promise<AgentTask> {
    this.startTask(task);

    try {
      const description = task.description;
      const input = task.input;

      // Analyze what coding task is needed
      const analysis = this.analyzeTask(description, input);

      // Simulate coding execution
      const result = {
        analysis,
        filesChanged: [] as string[],
        linesAdded: 0,
        linesRemoved: 0,
        summary: `Completed: ${description}`,
      };

      return this.completeTask(result);
    } catch (error) {
      return this.failTask(error instanceof Error ? error.message : String(error));
    }
  }

  private analyzeTask(description: string, input: Record<string, unknown>): {
    type: string;
    complexity: string;
    estimatedTime: number;
  } {
    const lower = description.toLowerCase();

    let type = "implementation";
    if (lower.includes("fix") || lower.includes("debug")) type = "bugfix";
    else if (lower.includes("refactor")) type = "refactoring";
    else if (lower.includes("optimize")) type = "optimization";
    else if (lower.includes("test")) type = "testing";

    let complexity = "simple";
    if (description.length > 200 || (input.files as string[])?.length > 5) complexity = "complex";
    else if (description.length > 100) complexity = "moderate";

    const estimatedTime = complexity === "simple" ? 5 : complexity === "moderate" ? 15 : 30;

    return { type, complexity, estimatedTime };
  }
}
