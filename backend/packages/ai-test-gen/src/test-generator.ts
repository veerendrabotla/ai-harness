import type { TestFile, TestSuite, TestConfig } from "./types.js";

export class AITestGenerator {
  private config: TestConfig;

  constructor(config: TestConfig) {
    this.config = {
      framework: config.framework,
      language: config.language,
      coverageThreshold: config.coverageThreshold,
    };
  }

  async generateTests(sourceCode: string, filename: string): Promise<TestFile> {
    const testContent = this.generateTestFromSource(sourceCode, filename);
    const testCases = this.extractTestCases(sourceCode);

    return {
      path: this.getTestPath(filename),
      content: testContent,
      testCount: Math.max(testCases.length, 1),
    };
  }

  async generateSuite(sourceCode: string, filename: string): Promise<TestSuite> {
    const testCases = this.extractTestCases(sourceCode);
    return {
      name: `${filename} tests`,
      tests: testCases.map((tc) => ({
        name: tc.name,
        description: tc.description,
        code: tc.code,
      })),
    };
  }

  private extractTestCases(sourceCode: string): Array<{ name: string; description: string; code: string }> {
    const cases: Array<{ name: string; description: string; code: string }> = [];

    // Extract exported functions
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = funcRegex.exec(sourceCode)) !== null) {
      const name = match[1]!;
      const params = match[2] ?? "";
      const paramCount = params ? params.split(",").length : 0;

      cases.push({
        name: `should call ${name} successfully`,
        description: `Test that ${name} can be invoked`,
        code: `// Arrange\nconst args = ${paramCount > 0 ? `[${Array(paramCount).fill("undefined").join(", ")}]` : "[]"};\n// Act\nconst result = ${name}(...args);\n// Assert\nexpect(result).toBeDefined();`,
      });

      // Check if function has conditional logic
      if (sourceCode.includes(`if (`) && sourceCode.includes(name)) {
        cases.push({
          name: `should handle edge cases for ${name}`,
          description: `Test boundary conditions of ${name}`,
          code: `// Act & Assert\nexpect(() => ${name}()).not.toThrow();`,
        });
      }
    }

    // Extract exported classes
    const classRegex = /(?:export\s+)?class\s+(\w+)/g;
    while ((match = classRegex.exec(sourceCode)) !== null) {
      const className = match[1];
      cases.push({
        name: `should instantiate ${className}`,
        description: `Test that ${className} can be constructed`,
        code: `// Arrange & Act\nconst instance = new ${className}();\n// Assert\nexpect(instance).toBeDefined();`,
      });

      // Extract methods
      const methodRegex = /(?:async\s+)?(\w+)\s*\(/g;
      const classBody = sourceCode.slice(match.index);
      const methodMatches = [...classBody.matchAll(methodRegex)].slice(1, 6);
      for (const mm of methodMatches) {
        const methodName = mm[1];
        if (methodName && !["constructor", "toString", "valueOf"].includes(methodName)) {
          cases.push({
            name: `should call ${className}.${methodName}`,
            description: `Test ${methodName} method`,
            code: `// Arrange\nconst instance = new ${className}();\n// Act\nconst result = instance.${methodName}();\n// Assert\nexpect(result).toBeDefined();`,
          });
        }
      }
    }

    // Extract exported constants/enums
    const constRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g;
    while ((match = constRegex.exec(sourceCode)) !== null) {
      const constName = match[1];
      cases.push({
        name: `should export ${constName}`,
        description: `Verify ${constName} is defined`,
        code: `expect(${constName}).toBeDefined();`,
      });
    }

    return cases;
  }

  private generateTestFromSource(sourceCode: string, filename: string): string {
    const importName = filename.replace(/\.[^.]+$/, "").split("/").pop() || "";
    const testCases = this.extractTestCases(sourceCode);
    const imports = new Set<string>();

    // Detect which imports the test needs
    if (sourceCode.includes("export function") || sourceCode.includes("export class")) {
      imports.add(importName);
    }

    const importLine = imports.size > 0
      ? `import { ${[...imports].join(", ")} } from "./${filename}";\n\n`
      : "";

    const describeBlocks = testCases.map((tc) => {
      return `  it("${tc.name}", () => {\n    ${tc.code.split("\n").join("\n    ")}\n  });`;
    }).join("\n\n");

    if (this.config.framework === "vitest") {
      return `import { describe, it, expect } from "vitest";
${importLine}describe("${importName}", () => {
${describeBlocks || '  it("should work correctly", () => {\n    expect(true).toBe(true);\n  });'}
});`;
    }

    return `describe("${importName}", () => {
${describeBlocks || '  it("should work correctly", () => {\n    expect(true).toBe(true);\n  });'}
});`;
  }

  private generateTestTemplate(filename: string): string {
    const importName = filename.replace(/\.[^.]+$/, "").split("/").pop() || "";

    if (this.config.framework === "vitest") {
      return `import { describe, it, expect } from "vitest";
import { ${importName} } from "./${filename}";

describe("${importName}", () => {
  it("should work correctly", () => {
    expect(true).toBe(true);
  });
});`;
    }

    return `describe("${importName}", () => {
  it("should work correctly", () => {
    expect(true).toBe(true);
  });
});`;
  }

  private getTestPath(sourcePath: string): string {
    const parts = sourcePath.split("/");
    const filename = parts.pop() || "";
    const testFilename = filename.replace(/\.(ts|tsx|js|jsx)$/, ".test.$1");
    return [...parts, testFilename].join("/");
  }
}
