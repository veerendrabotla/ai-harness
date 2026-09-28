import { AiHarnessClient } from "@ai-harness/sdk";

export interface CIConfig {
  client: AiHarnessClient;
  mode: "review" | "test" | "security" | "all";
  projectId: string;
  branch?: string;
  commitSha?: string;
  failOnIssues: boolean;
  outputFormat: "text" | "json" | "github-actions";
}

export interface CIResult {
  passed: boolean;
  issues: CIIssue[];
  summary: string;
  duration: number;
}

export interface CIIssue {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  rule?: string;
}

export async function runCIAgent(config: CIConfig): Promise<CIResult> {
  const start = Date.now();
  const issues: CIIssue[] = [];

  try {
    const goal = getGoalForMode(config.mode);
    const agentMode = config.mode === "test" || config.mode === "security" ? "BUILD" : "REVIEW";
    const task = await config.client.createTask({
      goal,
      projectId: config.projectId,
      agentMode,
    });

    for await (const event of config.client.streamEvents(task.id)) {
      if (event.eventType === "TOOL_COMPLETED" && (event.payload as Record<string, unknown>)?.output) {
        const output = (event.payload as Record<string, unknown>).output as Record<string, unknown>;
        if (output.issues && Array.isArray(output.issues)) {
          issues.push(...output.issues.map((i: Record<string, unknown>) => ({
            severity: (i.severity as CIIssue["severity"]) ?? "info",
            file: i.file as string | undefined,
            line: i.line as number | undefined,
            message: i.message as string,
            rule: i.rule as string | undefined,
          })));
        }
      }
    }

    const duration = Date.now() - start;
    const hasErrors = issues.some(i => i.severity === "error");

    return {
      passed: config.failOnIssues ? !hasErrors : true,
      issues,
      summary: `${config.mode} completed: ${issues.length} issues found in ${duration}ms`,
      duration,
    };
  } catch (err) {
    const duration = Date.now() - start;
    return {
      passed: false,
      issues: [{
        severity: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      }],
      summary: `${config.mode} failed: ${err instanceof Error ? err.message : "unknown"}`,
      duration,
    };
  }
}

function getGoalForMode(mode: CIConfig["mode"]): string {
  switch (mode) {
    case "review": return "Review the codebase for bugs, security issues, and code quality problems. Provide a detailed report.";
    case "test": return "Run all tests and report any failures. Analyze test coverage.";
    case "security": return "Perform a security audit. Check for vulnerabilities, secrets, and security best practices.";
    case "all": return "Perform a comprehensive review: code quality, tests, and security.";
  }
}

export function formatCIResult(result: CIResult, format: CIConfig["outputFormat"]): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "github-actions") {
    const lines: string[] = [];
    for (const issue of result.issues) {
      const level = issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "notice";
      const location = issue.file ? `::${issue.file}${issue.line ? `,line=${issue.line}` : ""}` : "";
      lines.push(`::${level}${location}::${issue.message}`);
    }
    return lines.join("\n");
  }

  const lines: string[] = [
    `CI Result: ${result.passed ? "PASSED" : "FAILED"}`,
    `Summary: ${result.summary}`,
    "",
  ];

  if (result.issues.length > 0) {
    lines.push("Issues:");
    for (const issue of result.issues) {
      const loc = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : "";
      lines.push(`  [${issue.severity.toUpperCase()}]${loc} ${issue.message}`);
    }
  }

  return lines.join("\n");
}
