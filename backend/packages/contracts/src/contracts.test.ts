import { describe, expect, it } from "vitest";
import {
  planDraftSchema,
  createTaskRequestSchema,
  createProjectRequestSchema,
  signupRequestSchema,
} from "./index.js";

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

  it("fills acceptanceCriteria and asserts defaults for legacy-shaped plans", () => {
    const parsed = planDraftSchema.parse({
      analysis: "x",
      steps: [{ id: "s1", title: "Only step" }],
      verificationPlan: [{ command: "npm test" }],
    });
    expect(parsed.steps[0]?.acceptanceCriteria).toEqual([]);
    expect(parsed.verificationPlan[0]?.asserts).toEqual([]);
  });

  it("accepts steps with acceptance criteria and commands with asserts", () => {
    const parsed = planDraftSchema.safeParse({
      analysis: "x",
      steps: [{ id: "s1", title: "step", acceptanceCriteria: ["README documents the flag"] }],
      verificationPlan: [
        { command: "grep flag README.md", asserts: ["README documents the flag"] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty and oversized acceptance criteria", () => {
    expect(
      planDraftSchema.safeParse({
        analysis: "x",
        steps: [{ id: "s1", title: "t", acceptanceCriteria: [""] }],
      }).success,
    ).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) => `criterion ${i}`);
    expect(
      planDraftSchema.safeParse({
        analysis: "x",
        steps: [{ id: "s1", title: "t", acceptanceCriteria: seven }],
      }).success,
    ).toBe(false);
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

describe("project creation contract — empty optionals", () => {
  const base = { name: "api-service", rootReference: "/" };

  it("treats an empty repositoryUrl as absent (form default must submit)", () => {
    const parsed = createProjectRequestSchema.safeParse({ ...base, repositoryUrl: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.repositoryUrl).toBeUndefined();
  });

  it("keeps a valid repositoryUrl", () => {
    const parsed = createProjectRequestSchema.safeParse({
      ...base,
      repositoryUrl: "https://github.com/org/repo",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.repositoryUrl).toBe("https://github.com/org/repo");
  });

  it("still rejects malformed repositoryUrl", () => {
    expect(createProjectRequestSchema.safeParse({ ...base, repositoryUrl: "not-a-url" }).success).toBe(false);
  });

  it("treats empty bridgeId and defaultBranch as absent", () => {
    const parsed = createProjectRequestSchema.safeParse({
      ...base,
      bridgeId: "",
      defaultBranch: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.bridgeId).toBeUndefined();
      expect(parsed.data.defaultBranch).toBeUndefined();
    }
  });

  it("still rejects malformed bridgeId", () => {
    expect(createProjectRequestSchema.safeParse({ ...base, bridgeId: "nope" }).success).toBe(false);
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
