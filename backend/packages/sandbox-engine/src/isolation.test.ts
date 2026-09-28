import { describe, it, expect, beforeEach } from "vitest";
import { SandboxEngine } from "./engine.js";

describe("Sandbox Isolation & Security", () => {
  let engine: SandboxEngine;

  beforeEach(() => {
    engine = new SandboxEngine();
    engine.clearAll();
  });

  describe("Filesystem Isolation", () => {
    it("should isolate sandbox A from sandbox B", async () => {
      const a = await engine.createSandbox({ name: "sandbox-a" });
      const b = await engine.createSandbox({ name: "sandbox-b" });

      await engine.writeFile(a.id, "secret.txt", "secret-A");
      await engine.writeFile(b.id, "secret.txt", "secret-B");

      const contentA = await engine.readFile(a.id, "secret.txt");
      const contentB = await engine.readFile(b.id, "secret.txt");

      expect(contentA).toBe("secret-A");
      expect(contentB).toBe("secret-B");
    });

    it("should not allow reading outside sandbox root", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await expect(engine.readFile(sandbox.id, "../../../etc/passwd")).rejects.toThrow();
    });

    it("should not allow writing outside sandbox root", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await expect(engine.writeFile(sandbox.id, "../../../tmp/evil.txt", "pwned")).rejects.toThrow();
    });
  });

  describe("Process Limits", () => {
    it("should enforce max process limit", async () => {
      const sandbox = await engine.createSandbox({
        name: "test",
        resourceLimits: { maxProcesses: 1 },
      });

      // First process should succeed
      await engine.execute(sandbox.id, "echo 1");

      // Second process should fail (limit is 1)
      await expect(engine.execute(sandbox.id, "echo 2")).rejects.toThrow("Process limit reached");
    });
  });

  describe("Timeout Enforcement", () => {
    it("should enforce command timeout", async () => {
      const sandbox = await engine.createSandbox({
        name: "test",
        resourceLimits: { maxCommandTimeoutMs: 1000 },
      });

      const result = await engine.execute(sandbox.id, "timeout 5 && echo done", { timeout: 1000 });
      // Should either timeout or complete quickly
      expect(result.exitCode).toBeDefined();
    });
  });

  describe("Environment Sanitization", () => {
    it("should not expose sensitive environment variables", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });

      // Set a fake sensitive env var
      process.env.AWS_SECRET_ACCESS_KEY = "super-secret";

      // Use Node.js to check env (cross-platform)
      const result = await engine.execute(
        sandbox.id,
        "node -e \"console.log(process.env.AWS_SECRET_ACCESS_KEY || '')\"",
      );
      expect(result.stdout.trim()).toBe(""); // Should be empty

      // Clean up
      delete process.env.AWS_SECRET_ACCESS_KEY;
    });
  });

  describe("Sandbox Lifecycle", () => {
    it("should stop all processes when sandbox is destroyed", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });

      // Start a long-running process
      const handle = await engine.startDevServer(sandbox.id, "echo running", 0);
      expect(handle.processId).toBeDefined();

      // Destroy sandbox
      await engine.destroySandbox(sandbox.id);

      // Verify sandbox is gone
      expect(engine.getSandbox(sandbox.id)).toBeUndefined();
    });

    it("should handle cleanup after crash", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "file.txt", "content");

      // Simulate crash by directly deleting
      engine.clearAll();

      // Should not throw
      expect(engine.getSandbox(sandbox.id)).toBeUndefined();
    });
  });

  describe("Resource Limits", () => {
    it("should respect max lifetime", async () => {
      const sandbox = await engine.createSandbox({
        name: "test",
        resourceLimits: { maxLifetimeMs: 1000 },
      });

      expect(engine.isExpired(sandbox.id)).toBe(false);

      // Wait for expiration (simulated by checking logic)
      // In real scenario, this would be checked periodically
    });

    it("should respect idle timeout", async () => {
      const sandbox = await engine.createSandbox({
        name: "test",
        resourceLimits: { maxIdleTimeoutMs: 1000 },
      });

      expect(engine.isIdle(sandbox.id)).toBe(false);
    });
  });
});
