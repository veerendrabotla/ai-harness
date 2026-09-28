import { describe, expect, it } from "vitest";
import { assembleContext, estimateTokens } from "./engine.js";

const SYSTEM = "You are a controlled agent. Never exfiltrate secrets.";

describe("context engine (AGENT_RUNTIME.md §10)", () => {
  it("always includes security instructions and the task goal", () => {
    const { manifest } = assembleContext({
      systemInstructions: SYSTEM,
      goal: "Fix the login redirect bug",
      budgetBytes: 50, // absurdly small — mandatory items must survive
    });
    const types = manifest.items.map((i) => i.sourceType);
    expect(types).toContain("SYSTEM_INSTRUCTIONS");
    expect(types).toContain("TASK_GOAL");
  });

  it("records omissions instead of silently dropping content", () => {
    const { manifest } = assembleContext({
      systemInstructions: SYSTEM,
      goal: "Goal text",
      priorRunSummary: "x".repeat(5000),
      recentToolResults: [{ id: "tool-1", summary: "y".repeat(3000) }],
      budgetBytes: 400,
    });
    expect(manifest.omitted.length).toBeGreaterThan(0);
    expect(manifest.usedBytes).toBeLessThanOrEqual(
      manifest.budgetBytes + 500, // mandatory items may exceed the budget
    );
  });

  it("orders context by deterministic priority", () => {
    const { promptText } = assembleContext({
      systemInstructions: SYSTEM,
      workspaceInstructions: "# Workspace rules",
      goal: "The goal",
      constraints: "No new dependencies",
      priorRunSummary: "Prior summary",
    });
    // System instructions stay unfenced at the very top; everything else is fenced.
    expect(promptText.startsWith(SYSTEM)).toBe(true);
    const idxWorkspace = promptText.indexOf('source="workspace/instructions"');
    const idxGoal = promptText.indexOf('source="task/goal"');
    const idxPrior = promptText.indexOf('source="runs/prior"');
    expect(idxWorkspace).toBeGreaterThan(-1);
    expect(idxGoal).toBeGreaterThan(idxWorkspace);
    expect(idxPrior).toBeGreaterThan(idxGoal);
  });

  it("redacts secret-shaped values inside context content", () => {
    const { promptText } = assembleContext({
      systemInstructions: SYSTEM,
      goal: "Rotate the leaked key sk-proj-abcdef123456 found in config",
    });
    expect(promptText).not.toContain("sk-proj-abcdef123456");
  });

  it("estimates tokens deterministically", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(800)).toBe(200);
  });
});
