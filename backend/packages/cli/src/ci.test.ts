import { describe, it, expect } from "vitest";
import { formatCIResult, type CIResult } from "./ci.js";

const result: CIResult = {
  passed: false,
  issues: [
    { severity: "error", file: "src/auth.ts", line: 42, message: "Missing input validation" },
    { severity: "warning", message: "Consider a named export" },
    { severity: "info", file: "README.md", message: "Docs updated" },
  ],
  summary: "review completed: 3 issues found in 12ms",
  duration: 12,
};

describe("formatCIResult", () => {
  it("emits valid GitHub Actions workflow commands with file= annotations", () => {
    const out = formatCIResult(result, "github-actions");
    expect(out.split("\n")).toEqual([
      "::error file=src/auth.ts,line=42::Missing input validation",
      "::warning::Consider a named export",
      "::notice file=README.md::Docs updated",
    ]);
  });

  it("emits a parseable JSON CIResult", () => {
    const parsed = JSON.parse(formatCIResult(result, "json")) as CIResult;
    expect(parsed.passed).toBe(false);
    expect(parsed.issues).toHaveLength(3);
    expect(parsed.duration).toBe(12);
  });

  it("renders the text summary with locations", () => {
    const out = formatCIResult(result, "text");
    expect(out).toContain("CI Result: FAILED");
    expect(out).toContain("[ERROR] (src/auth.ts:42) Missing input validation");
  });

  it("passes when no error-severity issues exist", () => {
    const clean: CIResult = { passed: true, issues: [], summary: "review completed: 0 issues found in 5ms", duration: 5 };
    expect(JSON.parse(formatCIResult(clean, "json")).passed).toBe(true);
    expect(formatCIResult(clean, "text")).toContain("CI Result: PASSED");
  });
});
