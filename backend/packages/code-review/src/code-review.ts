import type { ReviewComment, ReviewResult, ReviewConfig, ReviewSeverity } from "./types.js";

export class CodeReviewEngine {
  private config: ReviewConfig;

  constructor(config: ReviewConfig) {
    this.config = {
      rules: config.rules,
      maxComments: config.maxComments ?? 50,
      severityFilter: config.severityFilter ?? ["error", "warning", "info", "style"],
    };
  }

  reviewFile(sourceCode: string, filename: string): ReviewResult {
    const comments: ReviewComment[] = [];
    const lines = sourceCode.split("\n");

    for (const rule of this.config.rules) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] || "";
        const ruleComments = rule.check(sourceCode, line);
        for (const comment of ruleComments) {
          comment.line = i + 1;
          comments.push(comment);
        }
      }
    }

    const filteredComments = comments.filter((c) =>
      this.config.severityFilter!.includes(c.severity)
    );

    const truncated = filteredComments.slice(0, this.config.maxComments);
    const score = this.calculateScore(truncated);

    return {
      file: filename,
      comments: truncated,
      score,
      summary: this.generateSummary(truncated, score),
    };
  }

  private calculateScore(comments: ReviewComment[]): number {
    if (comments.length === 0) return 100;

    const penalty = comments.reduce((sum, c) => {
      switch (c.severity) {
        case "error": return sum + 10;
        case "warning": return sum + 5;
        case "info": return sum + 1;
        case "style": return sum + 0.5;
        default: return sum;
      }
    }, 0);

    return Math.max(0, Math.round(100 - penalty));
  }

  private generateSummary(comments: ReviewComment[], score: number): string {
    const errors = comments.filter((c) => c.severity === "error").length;
    const warnings = comments.filter((c) => c.severity === "warning").length;

    if (score >= 90) return "Excellent - No significant issues found";
    if (score >= 70) return `Good - ${warnings} warnings, ${errors} errors`;
    if (score >= 50) return `Needs improvement - ${warnings} warnings, ${errors} errors`;
    return `Poor - ${errors} errors, ${warnings} warnings require attention`;
  }

  getCommentsBySeverity(result: ReviewResult, severity: ReviewSeverity): ReviewComment[] {
    return result.comments.filter((c) => c.severity === severity);
  }

  getTopIssues(result: ReviewResult, count: number = 5): ReviewComment[] {
    return result.comments
      .sort((a, b) => {
        const order: ReviewSeverity[] = ["error", "warning", "info", "style"];
        return order.indexOf(a.severity) - order.indexOf(b.severity);
      })
      .slice(0, count);
  }
}
