/**
 * Planner Agent.
 * Breaks down goals into actionable steps.
 */
import { BaseAgent } from "./base-agent.js";
import type { AgentTask } from "./types.js";

export class PlannerAgent extends BaseAgent {
  constructor() {
    super("planner", "Planner", "Breaks down goals into actionable steps");
    this.capabilities = ["planning", "decomposition", "prioritization"];
  }

  async execute(task: AgentTask): Promise<AgentTask> {
    this.startTask(task);

    try {
      const goal = (task.input.goal as string) ?? task.description;
      const steps = this.decomposeGoal(goal);

      return this.completeTask({
        steps,
        totalSteps: steps.length,
        estimatedTime: steps.length * 5,
      });
    } catch (error) {
      return this.failTask(error instanceof Error ? error.message : String(error));
    }
  }

  private decomposeGoal(goal: string): Array<{ step: number; description: string; agent: string }> {
    const steps: Array<{ step: number; description: string; agent: string }> = [];
    const lowerGoal = goal.toLowerCase();

    // Analyze goal and create steps
    if (lowerGoal.includes("create") || lowerGoal.includes("build") || lowerGoal.includes("implement")) {
      steps.push({ step: 1, description: "Analyze requirements", agent: "planner" });
      steps.push({ step: 2, description: "Design architecture", agent: "planner" });
      steps.push({ step: 3, description: "Implement core functionality", agent: "coder" });
      steps.push({ step: 4, description: "Write tests", agent: "tester" });
      steps.push({ step: 5, description: "Review code", agent: "reviewer" });
    } else if (lowerGoal.includes("fix") || lowerGoal.includes("debug")) {
      steps.push({ step: 1, description: "Analyze the issue", agent: "coder" });
      steps.push({ step: 2, description: "Implement fix", agent: "coder" });
      steps.push({ step: 3, description: "Verify fix with tests", agent: "tester" });
    } else if (lowerGoal.includes("review") || lowerGoal.includes("audit")) {
      steps.push({ step: 1, description: "Code review", agent: "reviewer" });
      steps.push({ step: 2, description: "Security audit", agent: "reviewer" });
      steps.push({ step: 3, description: "Performance review", agent: "reviewer" });
    } else {
      // Default plan
      steps.push({ step: 1, description: "Understand the task", agent: "planner" });
      steps.push({ step: 2, description: "Implement solution", agent: "coder" });
      steps.push({ step: 3, description: "Verify solution", agent: "tester" });
    }

    return steps;
  }
}
