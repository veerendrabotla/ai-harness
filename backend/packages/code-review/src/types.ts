export type ReviewSeverity = "error" | "warning" | "info" | "style";

export interface ReviewComment {
  line: number;
  column?: number;
  severity: ReviewSeverity;
  message: string;
  rule: string;
  suggestion?: string;
}

export interface ReviewResult {
  file: string;
  comments: ReviewComment[];
  score: number;
  summary: string;
}

export interface ReviewRule {
  name: string;
  description: string;
  severity: ReviewSeverity;
  check: (content: string, line: string) => ReviewComment[];
}

export interface ReviewConfig {
  rules: ReviewRule[];
  maxComments?: number;
  severityFilter?: ReviewSeverity[];
}
