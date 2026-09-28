export interface TestFile {
  path: string;
  content: string;
  testCount: number;
}

export interface TestSuite {
  name: string;
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  description: string;
  code: string;
}

export interface TestConfig {
  framework: "vitest" | "jest" | "mocha";
  language: "typescript" | "javascript";
  coverageThreshold?: number;
}
