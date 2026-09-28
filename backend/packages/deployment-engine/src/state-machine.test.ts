import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateTransition,
  isTerminal,
  isActive,
  statusLabel,
  DEPLOYMENT_STATES,
} from "./state-machine.js";
import type { DeploymentStatus } from "./state-machine.js";

describe("Deployment State Machine", () => {
  it("should have all deployment states", () => {
    expect(DEPLOYMENT_STATES).toContain("QUEUED");
    expect(DEPLOYMENT_STATES).toContain("PREPARING");
    expect(DEPLOYMENT_STATES).toContain("BUILDING");
    expect(DEPLOYMENT_STATES).toContain("DEPLOYING");
    expect(DEPLOYMENT_STATES).toContain("HEALTH_CHECKING");
    expect(DEPLOYMENT_STATES).toContain("READY");
    expect(DEPLOYMENT_STATES).toContain("FAILED");
    expect(DEPLOYMENT_STATES).toContain("CANCELLED");
    expect(DEPLOYMENT_STATES).toContain("ROLLED_BACK");
    expect(DEPLOYMENT_STATES).toHaveLength(9);
  });

  describe("canTransition", () => {
    it("should allow valid forward transitions", () => {
      expect(canTransition("QUEUED", "PREPARING")).toBe(true);
      expect(canTransition("PREPARING", "BUILDING")).toBe(true);
      expect(canTransition("BUILDING", "DEPLOYING")).toBe(true);
      expect(canTransition("DEPLOYING", "HEALTH_CHECKING")).toBe(true);
      expect(canTransition("HEALTH_CHECKING", "READY")).toBe(true);
    });

    it("should allow failure from any active state", () => {
      const activeStates: DeploymentStatus[] = ["QUEUED", "PREPARING", "BUILDING", "DEPLOYING", "HEALTH_CHECKING"];
      for (const state of activeStates) {
        expect(canTransition(state, "FAILED")).toBe(true);
      }
    });

    it("should allow cancellation from any active state", () => {
      const activeStates: DeploymentStatus[] = ["QUEUED", "PREPARING", "BUILDING", "DEPLOYING", "HEALTH_CHECKING"];
      for (const state of activeStates) {
        expect(canTransition(state, "CANCELLED")).toBe(true);
      }
    });

    it("should allow rollback from READY", () => {
      expect(canTransition("READY", "ROLLED_BACK")).toBe(true);
    });

    it("should not allow transitions from terminal states", () => {
      expect(canTransition("FAILED", "READY")).toBe(false);
      expect(canTransition("CANCELLED", "READY")).toBe(false);
      expect(canTransition("ROLLED_BACK", "READY")).toBe(false);
      expect(canTransition("READY", "BUILDING")).toBe(false);
    });

    it("should not allow skipping states", () => {
      expect(canTransition("QUEUED", "BUILDING")).toBe(false);
      expect(canTransition("QUEUED", "DEPLOYING")).toBe(false);
      expect(canTransition("PREPARING", "DEPLOYING")).toBe(false);
    });

    it("should not allow backward transitions", () => {
      expect(canTransition("BUILDING", "PREPARING")).toBe(false);
      expect(canTransition("DEPLOYING", "BUILDING")).toBe(false);
      expect(canTransition("READY", "DEPLOYING")).toBe(false);
    });
  });

  describe("validateTransition", () => {
    it("should not throw for valid transitions", () => {
      expect(() => validateTransition("QUEUED", "PREPARING")).not.toThrow();
      expect(() => validateTransition("BUILDING", "FAILED")).not.toThrow();
    });

    it("should throw for invalid transitions", () => {
      expect(() => validateTransition("QUEUED", "BUILDING")).toThrow("Invalid deployment transition");
      expect(() => validateTransition("FAILED", "READY")).toThrow("Invalid deployment transition");
    });
  });

  describe("isTerminal", () => {
    it("should return true for terminal states", () => {
      expect(isTerminal("READY")).toBe(true);
      expect(isTerminal("FAILED")).toBe(true);
      expect(isTerminal("CANCELLED")).toBe(true);
      expect(isTerminal("ROLLED_BACK")).toBe(true);
    });

    it("should return false for active states", () => {
      expect(isTerminal("QUEUED")).toBe(false);
      expect(isTerminal("PREPARING")).toBe(false);
      expect(isTerminal("BUILDING")).toBe(false);
      expect(isTerminal("DEPLOYING")).toBe(false);
      expect(isTerminal("HEALTH_CHECKING")).toBe(false);
    });
  });

  describe("isActive", () => {
    it("should return true for active states", () => {
      expect(isActive("QUEUED")).toBe(true);
      expect(isActive("PREPARING")).toBe(true);
      expect(isActive("BUILDING")).toBe(true);
      expect(isActive("DEPLOYING")).toBe(true);
      expect(isActive("HEALTH_CHECKING")).toBe(true);
    });

    it("should return false for terminal states", () => {
      expect(isActive("READY")).toBe(false);
      expect(isActive("FAILED")).toBe(false);
      expect(isActive("CANCELLED")).toBe(false);
      expect(isActive("ROLLED_BACK")).toBe(false);
    });
  });

  describe("statusLabel", () => {
    it("should return human-readable labels", () => {
      expect(statusLabel("QUEUED")).toBe("Queued");
      expect(statusLabel("PREPARING")).toBe("Preparing");
      expect(statusLabel("BUILDING")).toBe("Building");
      expect(statusLabel("DEPLOYING")).toBe("Deploying");
      expect(statusLabel("HEALTH_CHECKING")).toBe("Health Check");
      expect(statusLabel("READY")).toBe("Ready");
      expect(statusLabel("FAILED")).toBe("Failed");
      expect(statusLabel("CANCELLED")).toBe("Cancelled");
      expect(statusLabel("ROLLED_BACK")).toBe("Rolled Back");
    });
  });
});
