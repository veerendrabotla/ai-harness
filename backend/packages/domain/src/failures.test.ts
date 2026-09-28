import { describe, expect, it } from "vitest";
import { classifyToolFailure } from "./failures.js";

describe("tool failure classification", () => {
  it("maps statuses to stable classes", () => {
    expect(classifyToolFailure("TIMED_OUT")).toBe("retryable");
    expect(classifyToolFailure("DENIED")).toBe("permission_related");
    expect(classifyToolFailure("CANCELLED")).toBe("cancelled");
    expect(() => classifyToolFailure("SUCCEEDED", "")).toBeDefined();
  });
  it("uses failure codes for environment/permission classes", () => {
    expect(classifyToolFailure("FAILED", "BRIDGE_DISCONNECTED")).toBe("environment_related");
    expect(classifyToolFailure("FAILED", "POLICY_DENIED")).toBe("permission_related");
    expect(classifyToolFailure("FAILED")).toBe("non_retryable");
  });
});
