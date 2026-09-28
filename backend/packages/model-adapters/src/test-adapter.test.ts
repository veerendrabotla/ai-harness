import { describe, it, expect } from "vitest";
import { TestAdapter } from "./test-adapter.js";
import type { ModelRequest, ProviderConnectionRef } from "./types.js";

function makeConnection(credential: string): ProviderConnectionRef {
  return {
    id: "test-conn",
    providerType: "TEST",
    displayName: "Test Provider",
    credential,
  };
}

function makeRequest(overrides?: Partial<ModelRequest>): ModelRequest {
  return {
    stage: "PLANNING",
    modelIdentifier: "test-model",
    systemInstructions: "test instructions",
    userObjective: "test objective",
    contextItems: "",
    responseSchemaName: "PLAN",
    ...overrides,
  };
}

describe("TestAdapter", () => {
  const adapter = new TestAdapter();

  it("has providerType TEST", () => {
    expect(adapter.providerType).toBe("TEST");
  });

  it("health check always succeeds", async () => {
    const result = await adapter.healthCheck(makeConnection("any"));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("TEST adapter");
  });

  describe("plan-then-execute scenario", () => {
    const conn = makeConnection("plan-then-execute");

    it("returns valid plan JSON during PLANNING stage", async () => {
      const response = await adapter.generate(makeRequest({ stage: "PLANNING" }), conn);
      const plan = JSON.parse(response.text);
      expect(plan).toHaveProperty("analysis");
      expect(plan).toHaveProperty("steps");
      expect(plan.steps.length).toBe(2);
      expect(plan.steps[0].toolName).toBe("filesystem.create");
      expect(response.providerType).toBe("TEST");
      expect(response.finishReason).toBe("stop");
    });

    it("returns tool calls during IMPLEMENTATION stage", async () => {
      const response = await adapter.generate(
        makeRequest({ stage: "IMPLEMENTATION", responseSchemaName: "FREEFORM" }),
        conn,
      );
      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      const first = response.toolCalls?.at(0);
      expect(first?.name).toBe("filesystem.create");
    });
  });

  describe("plan-only scenario", () => {
    const conn = makeConnection("plan-only");

    it("returns a plan with no tool-calling steps", async () => {
      const response = await adapter.generate(makeRequest({ stage: "PLANNING" }), conn);
      const plan = JSON.parse(response.text);
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].toolName).toBeUndefined();
    });
  });

  describe("failure scenarios", () => {
    it("fail-planning throws non-retryable error on PLANNING", async () => {
      const conn = makeConnection("fail-planning");
      await expect(adapter.generate(makeRequest({ stage: "PLANNING" }), conn))
        .rejects.toThrow("simulated planning failure");
    });

    it("fail-execution throws non-retryable error on IMPLEMENTATION", async () => {
      const conn = makeConnection("fail-execution");
      await expect(adapter.generate(makeRequest({ stage: "IMPLEMENTATION", responseSchemaName: "FREEFORM" }), conn))
        .rejects.toThrow("simulated execution failure");
    });

    it("fail-retryable throws retryable error", async () => {
      const conn = makeConnection("fail-retryable");
      await expect(adapter.generate(makeRequest(), conn))
        .rejects.toThrow("simulated retryable failure");
    });
  });

  describe("REVIEW stage", () => {
    it("returns valid review JSON", async () => {
      const conn = makeConnection("default");
      const response = await adapter.generate(makeRequest({ stage: "REVIEW" }), conn);
      const review = JSON.parse(response.text);
      expect(review).toHaveProperty("blocking");
      expect(review).toHaveProperty("non_blocking");
      expect(review).toHaveProperty("confidence");
    });
  });

  describe("stream", () => {
    it("calls onDelta and returns response", async () => {
      const conn = makeConnection("default");
      const deltas: string[] = [];
      const response = await adapter.stream(makeRequest(), conn, (d) => deltas.push(d));
      expect(deltas.length).toBeGreaterThan(0);
      expect(response.text).toBe(deltas.join(""));
    });
  });
});
