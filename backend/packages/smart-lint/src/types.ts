export type LintSeverity = "error" | "warning" | "info";

export interface LintRule {
  name: string;
  description: string;
  severity: LintSeverity;
  pattern?: RegExp;
  check: (content: string) => LintResult[];
}

export interface LintResult {
  rule: string;
  severity: LintSeverity;
  message: string;
  line?: number;
  column?: number;
}

export interface LintConfig {
  rules: LintRule[];
  ignorePatterns?: string[];
}
