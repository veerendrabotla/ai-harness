import type { LintRule, LintResult, LintConfig } from "./types.js";

export class SmartLinter {
  private config: LintConfig;

  constructor(config: LintConfig) {
    this.config = {
      rules: config.rules,
      ignorePatterns: config.ignorePatterns || [],
    };
  }

  lintFile(content: string, filename?: string): LintResult[] {
    if (filename && this.shouldIgnore(filename)) {
      return [];
    }

    const results: LintResult[] = [];

    for (const rule of this.config.rules) {
      const ruleResults = rule.check(content);
      results.push(...ruleResults);
    }

    return results;
  }

  lintFiles(files: { name: string; content: string }[]): Map<string, LintResult[]> {
    const results = new Map<string, LintResult[]>();

    for (const file of files) {
      results.set(file.name, this.lintFile(file.content, file.name));
    }

    return results;
  }

  private shouldIgnore(filename: string): boolean {
    return this.config.ignorePatterns?.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        return regex.test(filename);
      }
      return filename.includes(pattern);
    }) ?? false;
  }

  addRule(rule: LintRule): void {
    this.config.rules.push(rule);
  }

  removeRule(name: string): boolean {
    const index = this.config.rules.findIndex((r) => r.name === name);
    if (index >= 0) {
      this.config.rules.splice(index, 1);
      return true;
    }
    return false;
  }
}
