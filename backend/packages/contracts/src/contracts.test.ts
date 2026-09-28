import { describe, expect, it } from "vitest";
import { planDraftSchema, createTaskRequestSchema, signupRequestSchema } from "./index.js";

describe("plan draft contract", () => {
  it("accepts a complete valid plan", () => {
    const parsed = planDraftSchema.safeParse({
      analysis: "The bug is in parser.ts",
      assumptions: ["Node 22 runtime"],
      affectedFiles: ["src/parser.ts"],
      steps: [{ id: "s1", title: "Reproduce failing case" }],
      risks: ["Regression in edge parsing"],
      verificationPlan: [{ command: "npm test" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires at least one step", () => {
    const parsed = planDraftSchema.safeParse({
      analysis: "x",
      steps: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("fills defaults for optional arrays", () => {
    const parsed = planDraftSchema.parse({
      analysis: "x",
      steps: [{ id: "s1", title: "Only step" }],
    });
    expect(parsed.risks).toEqual([]);
    expect(parsed.verificationPlan).toEqual([]);
    expect(parsed.affectedFiles).toEqual([]);
  });
});

describe("task creation contract", () => {
  const base = {
    workspaceId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
    projectId: "6f9619ff-8b86-d011-b42d-00c04fc964fe",
    goal: "Add a retry button to the export dialog",
  };

  it("defaults to ROUTED mode", () => {
    const parsed = createTaskRequestSchema.parse(base);
    expect(parsed.selectedModelMode).toBe("ROUTED");
  });

  it("rejects MANUAL mode without modelOverride", () => {
    const parsed = createTaskRequestSchema.safeParse({ ...base, selectedModelMode: "MANUAL" });
    expect(parsed.success).toBe(false);
  });

  it("accepts MANUAL mode with full override", () => {
    const parsed = createTaskRequestSchema.safeParse({
      ...base,
      selectedModelMode: "MANUAL",
      modelOverride: {
        providerConnectionId: "6f9619ff-8b86-d011-b42d-00c04fc964fd",
        modelIdentifier: "claude-sonnet-4-5",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("enforces minimum goal length", () => {
    expect(createTaskRequestSchema.safeParse({ ...base, goal: "ab" }).success).toBe(false);
  });
});

describe("signup contract", () => {
  it("enforces password strength rules", () => {
    const valid = signupRequestSchema.safeParse({
      email: "user@example.com",
      password: "GoodPass123",
      displayName: "User",
    });
    expect(valid.success).toBe(true);

    for (const bad of ["short1A", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"]) {
      expect(
        signupRequestSchema.safeParse({ email: "user@example.com", password: bad, displayName: "U" }).success,
      ).toBe(false);
    }
  });

  it("normalizes nothing silently — emails stay as provided (service lowercases)", () => {
    const parsed = signupRequestSchema.parse({
      email: "User@Example.COM",
      password: "GoodPass123",
      displayName: "U",
    });
    expect(parsed.email).toBe("User@Example.COM");
  });
});
