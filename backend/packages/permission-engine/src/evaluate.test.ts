import { describe, expect, it } from "vitest";
import { evaluatePermission } from "./evaluate.js";
import type { PolicySnapshot } from "./types.js";
import { buildPolicySnapshot } from "./snapshot.js";

function snapshot(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    workspaceId: "ws-1",
    policyId: "p-1",
    requirePlanApproval: true,
    allowDirectExecution: false,
    maxTaskDurationSeconds: 1800,
    maxToolCallsPerRun: 50,
    maxSubagents: 0,
    blockOnReviewFindings: false,
    rules: [],
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("permission engine", () => {
  it("allows READ tools by default when no rules exist", () => {
    const result = evaluatePermission(snapshot(), { toolName: "filesystem.read", riskLevel: "READ" });
    expect(result.outcome).toBe("ALLOW");
  });

  it("asks for approval on WRITE tools by default", () => {
    const result = evaluatePermission(snapshot(), { toolName: "filesystem.write", riskLevel: "WRITE" });
    expect(result.outcome).toBe("ASK");
  });

  it("denies when an explicit rule denies the tool", () => {
    const snap = snapshot({
      rules: [{ id: "r1", toolName: "terminal.run", actionPattern: null, riskLevel: "DESTRUCTIVE", decision: "DENY" }],
    });
    const result = evaluatePermission(snap, { toolName: "terminal.run", riskLevel: "DESTRUCTIVE" });
    expect(result.outcome).toBe("DENY");
    expect(result.matchedRuleId).toBe("r1");
  });

  it("DENY wins even over an active TASK-scope approval", () => {
    const snap = snapshot({
      rules: [{ id: "r1", toolName: "filesystem.delete", actionPattern: null, riskLevel: "DESTRUCTIVE", decision: "DENY" }],
    });
    const result = evaluatePermission(snap, {
      toolName: "filesystem.delete",
      riskLevel: "DESTRUCTIVE",
      approvals: { taskScopeToolNames: ["filesystem.delete"] },
    });
    expect(result.outcome).toBe("DENY");
  });

  it("honors TASK-scope approvals without any matching rule", () => {
    const result = evaluatePermission(snapshot(), {
      toolName: "terminal.run",
      riskLevel: "DESTRUCTIVE",
      approvals: { taskScopeToolNames: ["terminal.run"] },
    });
    expect(result.outcome).toBe("ALLOW");
  });

  it("matches wildcard patterns", () => {
    const snap = snapshot({
      rules: [{ id: "w1", toolName: "git.*", actionPattern: null, riskLevel: "READ", decision: "ALLOW" }],
    });
    expect(evaluatePermission(snap, { toolName: "git.status", riskLevel: "READ" }).outcome).toBe("ALLOW");
    expect(evaluatePermission(snap, { toolName: "git.diff", riskLevel: "READ" }).outcome).toBe("ALLOW");
    expect(evaluatePermission(snap, { toolName: "terminal.run", riskLevel: "DESTRUCTIVE" }).outcome).toBe("ASK");
  });

  it("exact tool match beats wildcard", () => {
    const snap = snapshot({
      rules: [
        { id: "exact", toolName: "http.request", actionPattern: null, riskLevel: "EXTERNAL", decision: "ALLOW" },
        { id: "wild", toolName: "http.*", actionPattern: null, riskLevel: "EXTERNAL", decision: "ASK" },
      ],
    });
    const exact = evaluatePermission(snap, { toolName: "http.request", riskLevel: "EXTERNAL" });
    expect(exact.matchedRuleId).toBe("exact");
  });

  it("never silently auto-approves DESTRUCTIVE risk even under an ALLOW rule (defense-in-depth)", () => {
    const snap = snapshot({
      rules: [{ id: "permissive", toolName: "*", actionPattern: null, riskLevel: "DESTRUCTIVE", decision: "ALLOW" }],
    });
    const result = evaluatePermission(snap, { toolName: "filesystem.delete", riskLevel: "DESTRUCTIVE" });
    expect(result.outcome).toBe("ASK");
  });

  it("EXTERNAL tools require approval by default", () => {
    const result = evaluatePermission(snapshot(), { toolName: "mcp.call", riskLevel: "EXTERNAL" });
    expect(result.outcome).toBe("ASK");
  });
});

describe("repo-wiki pre-approved zone", () => {
  it("allows writes under .aiharness/wiki/ without a rule", () => {
    const result = evaluatePermission(snapshot(), {
      toolName: "filesystem.write",
      riskLevel: "WRITE",
      resourcePath: ".aiharness/wiki/index.md",
    });
    expect(result.outcome).toBe("ALLOW");
    expect(result.reason).toContain("repo-wiki zone");
  });

  it("allows filesystem.create into the wiki dir (backslash paths included)", () => {
    const result = evaluatePermission(snapshot(), {
      toolName: "filesystem.create",
      riskLevel: "WRITE",
      resourcePath: ".aiharness\\wiki\\pages\\architecture.md",
    });
    expect(result.outcome).toBe("ALLOW");
  });

  it("still asks for writes outside the wiki zone", () => {
    const result = evaluatePermission(snapshot(), {
      toolName: "filesystem.write",
      riskLevel: "WRITE",
      resourcePath: "src/app.ts",
    });
    expect(result.outcome).toBe("ASK");
  });

  it("rejects traversal sneaking out of the wiki zone", () => {
    const result = evaluatePermission(snapshot(), {
      toolName: "filesystem.write",
      riskLevel: "WRITE",
      resourcePath: ".aiharness/wiki/../../secrets.md",
    });
    expect(result.outcome).toBe("ASK");
  });

  it("rejects sibling dirs that merely share the prefix", () => {
    const result = evaluatePermission(snapshot(), {
      toolName: "filesystem.write",
      riskLevel: "WRITE",
      resourcePath: ".aiharness/wikifoo/x.md",
    });
    expect(result.outcome).toBe("ASK");
  });

  it("escalates wiki .env writes to ASK", () => {
    const result = evaluatePermission(snapshot(), {
      toolName: "filesystem.write",
      riskLevel: "WRITE",
      resourcePath: ".aiharness/wiki/.env",
    });
    expect(result.outcome).toBe("ASK");
  });

  it("explicit policy rules still win over the wiki zone", () => {
    const ask = snapshot({
      rules: [{ id: "ask-wiki", toolName: "filesystem.write", actionPattern: null, riskLevel: "WRITE", decision: "ASK" }],
    });
    expect(
      evaluatePermission(ask, { toolName: "filesystem.write", riskLevel: "WRITE", resourcePath: ".aiharness/wiki/index.md" }).outcome,
    ).toBe("ASK");

    const deny = snapshot({
      rules: [{ id: "deny-wiki", toolName: "filesystem.*", actionPattern: null, riskLevel: "WRITE", decision: "DENY" }],
    });
    expect(
      evaluatePermission(deny, { toolName: "filesystem.write", riskLevel: "WRITE", resourcePath: ".aiharness/wiki/index.md" }).outcome,
    ).toBe("DENY");
  });
});

describe("policy snapshot builder", () => {
  it("builds an immutable snapshot from structural policy input", () => {
    const snap = buildPolicySnapshot({
      id: "pol-1",
      workspaceId: "ws-9",
      requirePlanApproval: false,
      allowDirectExecution: true,
      maxTaskDurationSeconds: 600,
      maxToolCallsPerRun: 10,
      maxSubagents: 0,
      toolRules: [
        { id: "tr-1", toolName: "git.status", actionPattern: null, riskLevel: "READ", decision: "ALLOW" },
      ],
    });
    expect(snap.policyId).toBe("pol-1");
    expect(snap.requirePlanApproval).toBe(false);
    expect(snap.rules).toHaveLength(1);
    expect(snap.capturedAt).toBeTruthy();
  });
});
