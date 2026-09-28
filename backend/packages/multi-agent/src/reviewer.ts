/**
 * Reviewer Agent.
 * Reviews code quality, security, and patterns.
 */
import { BaseAgent } from "./base-agent.js";
import type { AgentTask } from "./types.js";

export class ReviewerAgent extends BaseAgent {
  constructor() {
    super("reviewer", "Reviewer", "Reviews code quality, security, and patterns");
    this.capabilities = ["code_review", "security_audit", "pattern_check", "quality_analysis"];
  }

  async execute(task: AgentTask): Promise<AgentTask> {
    this.startTask(task);

    try {
      const description = task.description;
      const input = task.input;

      // Perform code review
      const review = this.performReview(description, input);

      return this.completeTask(review);
    } catch (error) {
      return this.failTask(error instanceof Error ? error.message : String(error));
    }
  }

  private performReview(description: string, input: Record<string, unknown>): {
    issues: Array<{ severity: string; message: string; file?: string }>;
    score: number;
    recommendations: string[];
  } {
    const issues: Array<{ severity: string; message: string; file?: string }> = [];
    const recommendations: string[] = [];

    // Analyze code quality
    const code = (input.code as string) ?? "";
    if (code.length === 0) {
      issues.push({ severity: "info", message: "No code provided for review" });
    }

    // Check for common issues
    if (code.includes("eval(")) {
      issues.push({ severity: "critical", message: "eval() usage detected - security risk" });
    }
    if (code.includes("innerHTML")) {
      issues.push({ severity: "high", message: "innerHTML usage - potential XSS vulnerability" });
    }
    if (code.includes("console.log") && !code.includes("// debug")) {
      issues.push({ severity: "low", message: "console.log statements should be removed" });
    }

    // Generate recommendations
    if (code.includes("any")) {
      recommendations.push("Consider replacing 'any' types with specific types");
    }
    if (code.includes("TODO")) {
      recommendations.push("Address TODO comments before merging");
    }

    const score = Math.max(0, 100 - issues.length * 10);

    return { issues, score, recommendations };
  }
}
