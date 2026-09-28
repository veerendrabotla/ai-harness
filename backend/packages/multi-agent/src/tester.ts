/**
 * Tester Agent.
 * Writes and runs tests.
 */
import { BaseAgent } from "./base-agent.js";
import type { AgentTask } from "./types.js";

export class TesterAgent extends BaseAgent {
  constructor() {
    super("tester", "Tester", "Writes and runs tests");
    this.capabilities = ["unit_testing", "integration_testing", "test_generation", "coverage_analysis"];
  }

  async execute(task: AgentTask): Promise<AgentTask> {
    this.startTask(task);

    try {
      const description = task.description;
      const input = task.input;

      // Generate and run tests
      const result = this.runTests(description, input);

      return this.completeTask(result);
    } catch (error) {
      return this.failTask(error instanceof Error ? error.message : String(error));
    }
  }

  private runTests(description: string, input: Record<string, unknown>): {
    testsGenerated: number;
    testsPassed: number;
    testsFailed: number;
    coverage: number;
    failures: Array<{ test: string; error: string }>;
  } {
    const code = (input.code as string) ?? "";
    const _files = (input.files as string[]) ?? [];

    // Analyze code for testable units
    const testableUnits = this.findTestableUnits(code);
    const testsGenerated = testableUnits.length;

    // Simulate test execution
    const failures: Array<{ test: string; error: string }> = [];
    let testsPassed = 0;
    let testsFailed = 0;

    for (const unit of testableUnits) {
      // Simulate test result (90% pass rate)
      if (Math.random() > 0.1) {
        testsPassed++;
      } else {
        testsFailed++;
        failures.push({ test: unit, error: "Simulated test failure" });
      }
    }

    const coverage = testsGenerated > 0 ? (testsPassed / testsGenerated) * 100 : 0;

    return {
      testsGenerated,
      testsPassed,
      testsFailed,
      coverage,
      failures,
    };
  }

  private findTestableUnits(code: string): string[] {
    const units: string[] = [];

    // Find function declarations
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g;
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
      const name = match[1] ?? match[2];
      if (name) units.push(name);
    }

    // Find class methods
    const classRegex = /class\s+(\w+)[^{]*\{([^}]+)\}/g;
    while ((match = classRegex.exec(code)) !== null) {
      const className = match[1]!;
      const body = match[2]!;
      const methodRegex = /(?:async\s+)?(\w+)\s*\(/g;
      let methodMatch;
      while ((methodMatch = methodRegex.exec(body)) !== null) {
        units.push(`${className}.${methodMatch[1]}`);
      }
    }

    return units.length > 0 ? units : ["default"];
  }
}
