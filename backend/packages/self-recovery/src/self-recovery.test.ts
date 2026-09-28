import { describe, it, expect, beforeEach } from "vitest";
import { SelfRecoveryEngine } from "./recovery-engine.js";

describe("SelfRecoveryEngine", () => {
  let engine: SelfRecoveryEngine;

  beforeEach(() => {
    engine = new SelfRecoveryEngine();
  });

  describe("Error Classification", () => {
    it("should classify timeout errors", () => {
      expect(engine.classify(new Error("Request timeout"))).toBe("TIMEOUT");
      expect(engine.classify(new Error("Timed out"))).toBe("TIMEOUT");
    });

    it("should classify network errors", () => {
      expect(engine.classify(new Error("ECONNREFUSED"))).toBe("NETWORK_FAILURE");
      expect(engine.classify(new Error("ENOTFOUND"))).toBe("NETWORK_FAILURE");
    });

    it("should classify permission errors", () => {
      expect(engine.classify(new Error("Permission denied"))).toBe("PERMISSION_FAILURE");
      expect(engine.classify(new Error("Access denied"))).toBe("PERMISSION_FAILURE");
    });

    it("should classify type errors", () => {
      expect(engine.classify(new TypeError("Cannot read property"))).toBe("TYPE_ERROR");
    });

    it("should classify model errors", () => {
      expect(engine.classify(new Error("Rate limit exceeded 429"))).toBe("MODEL_FAILURE");
    });

    it("should classify unknown errors", () => {
      expect(engine.classify(new Error("Something random"))).toBe("UNKNOWN");
    });
  });

  describe("Recovery Attempts", () => {
    it("should attempt recovery for retryable errors", async () => {
      let attempts = 0;
      const result = await engine.attemptRecovery(
        new Error("ECONNREFUSED"),
        async () => {
          attempts++;
          if (attempts < 2) throw new Error("Still failing");
        }
      );

      expect(result.recovered).toBe(true);
      expect(result.attempts.length).toBeGreaterThan(0);
    });

    it("should abort after max retries", async () => {
      const result = await engine.attemptRecovery(
        new Error("ECONNREFUSED"),
        async () => {
          throw new Error("Still failing");
        }
      );

      expect(result.recovered).toBe(false);
      expect(result.attempts.length).toBeGreaterThanOrEqual(1);
    });

    it("should not retry non-retryable errors", async () => {
      const result = await engine.attemptRecovery(
        new Error("Permission denied"),
        async () => {}
      );

      expect(result.recovered).toBe(false);
      expect(result.attempts.length).toBe(0);
    });
  });

  describe("History", () => {
    it("should track recovery history", async () => {
      await engine.attemptRecovery(new Error("timeout"), async () => {});
      expect(engine.getHistory().length).toBeGreaterThan(0);
    });

    it("should clear history", async () => {
      await engine.attemptRecovery(new Error("timeout"), async () => {});
      engine.clearHistory();
      expect(engine.getHistory().length).toBe(0);
    });
  });
});
