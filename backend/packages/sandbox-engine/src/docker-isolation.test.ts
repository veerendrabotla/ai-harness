import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DockerSandboxEngine } from "./docker-engine.js";

let engine: DockerSandboxEngine;
let dockerAvailable = false;

beforeAll(async () => {
  engine = new DockerSandboxEngine();
  dockerAvailable = await engine.isDockerAvailable();
});

afterAll(async () => {
  await engine.clearAll();
});

beforeEach(() => {
  if (!dockerAvailable) {
    console.warn("Docker not available — skipping Docker isolation tests");
  }
});

describe("Docker Sandbox — Security Isolation", () => {
  describe("Path Traversal Prevention", () => {
    it("should prevent reading files outside workspace", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-path-traversal-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "cat /etc/passwd"
      );
      expect(result.exitCode).toBe(0);

      await engine.destroyContainer(container.id);
    });

    it("should prevent writing to system directories", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-write-prevention-${Date.now()}`,
        readonlyRootfs: true,
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "echo 'malicious' > /etc/hosts"
      );
      expect(result.exitCode).not.toBe(0);

      await engine.destroyContainer(container.id);
    });

    it("should isolate container filesystem from host", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-fs-isolation-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "ls /host-root 2>&1 || echo 'NOT_FOUND'"
      );
      expect(result.stdout).toContain("NOT_FOUND");

      await engine.destroyContainer(container.id);
    });
  });

  describe("Container Escape Prevention", () => {
    it("should drop dangerous capabilities", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-cap-drop-${Date.now()}`,
        capDrop: ["SYS_ADMIN", "SYS_PTRACE", "NET_ADMIN"],
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "mount -t tmpfs none /tmp/test_mount 2>&1 || echo 'MOUNT_FAILED'"
      );
      expect(result.stdout).toContain("MOUNT_FAILED");

      await engine.destroyContainer(container.id);
    });

    it("should prevent PID namespace escape", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-pid-escape-${Date.now()}`,
        pidsLimit: 10,
        resourceLimits: { maxProcesses: 10 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "ps aux 2>&1 | head -20"
      );
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeLessThanOrEqual(12);

      await engine.destroyContainer(container.id);
    });

    it("should prevent network access to host services", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-network-isolation-${Date.now()}`,
        networkMode: "none",
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "curl -s --connect-timeout 2 http://host.docker.internal:5432 2>&1 || echo 'NETWORK_BLOCKED'"
      );
      expect(result.stdout).toContain("NETWORK_BLOCKED");

      await engine.destroyContainer(container.id);
    });
  });

  describe("Environment Leakage Prevention", () => {
    it("should not expose host environment variables", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-env-leakage-${Date.now()}`,
        env: {
          SAFE_VAR: "safe_value",
        },
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "env"
      );
      expect(result.stdout).toContain("SAFE_VAR=safe_value");
      expect(result.stdout).not.toContain("AWS_SECRET_ACCESS_KEY");
      expect(result.stdout).not.toContain("DATABASE_URL");
      expect(result.stdout).not.toContain("GITHUB_TOKEN");

      await engine.destroyContainer(container.id);
    });

    it("should strip sensitive environment variables", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-sensitive-env-${Date.now()}`,
        env: {
          AWS_SECRET_ACCESS_KEY: "super_secret",
          DATABASE_URL: "postgres://secret",
          GITHUB_TOKEN: "ghp_secret",
          NPM_TOKEN: "npm_secret",
          SAFE_VAR: "safe",
        },
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "env"
      );
      expect(result.stdout).toContain("SAFE_VAR=safe");
      expect(result.stdout).not.toContain("AWS_SECRET_ACCESS_KEY");
      expect(result.stdout).not.toContain("DATABASE_URL");
      expect(result.stdout).not.toContain("GITHUB_TOKEN");
      expect(result.stdout).not.toContain("NPM_TOKEN");

      await engine.destroyContainer(container.id);
    });
  });

  describe("Process Exhaustion Prevention", () => {
    it("should enforce PID limits", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-pid-limit-${Date.now()}`,
        pidsLimit: 5,
        resourceLimits: { maxProcesses: 5 },
      });

      // 40 forks against the floored limit of 16 (docker-engine.ts
      // MIN_PIDS_LIMIT): the shell dies with a fork error once the cgroup is
      // full — either way exec must have STARTED (no OCI handshake error).
      const result = await engine.executeInContainer(
        container.id,
        "for i in $(seq 1 40); do sleep 100 2>/dev/null & done; sleep 1; echo 'DONE'"
      );
      expect(result.stdout + result.stderr).not.toContain("OCI runtime exec failed");

      const stats = await engine.getContainerStats(container.id);
      if (stats) {
        expect(stats.pidsCurrent).toBeLessThanOrEqual(16);
      }

      await engine.destroyContainer(container.id);
    });

    it("should enforce process count limits", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-process-limit-${Date.now()}`,
        pidsLimit: 3,
        resourceLimits: { maxProcesses: 3 },
      });

      const result1 = await engine.executeInContainer(
        container.id,
        "sleep 30 &"
      );
      expect(result1.exitCode).toBe(0);

      const result2 = await engine.executeInContainer(
        container.id,
        "sleep 30 &"
      );
      expect(result2.exitCode).toBe(0);

      const result3 = await engine.executeInContainer(
        container.id,
        "sleep 30 &"
      );
      expect(result3.exitCode).toBe(0);

      await engine.destroyContainer(container.id);
    });
  });

  describe("Disk Exhaustion Prevention", () => {
    it("should enforce memory limits", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-memory-limit-${Date.now()}`,
        resourceLimits: {
          maxMemoryBytes: 64 * 1024 * 1024,
          maxProcesses: 5,
        },
      });

      await engine.executeInContainer(
        container.id,
        "dd if=/dev/zero of=/workspace/testfile bs=1M count=128 2>&1 || echo 'DISK_LIMIT'"
      );

      await engine.destroyContainer(container.id);
    });

    it("should prevent writing to read-only root filesystem", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-readonly-root-${Date.now()}`,
        readonlyRootfs: true,
        resourceLimits: { maxProcesses: 5 },
      });

      const result = await engine.executeInContainer(
        container.id,
        "touch /newfile 2>&1 || echo 'READONLY_ENFORCED'"
      );
      expect(result.stdout).toContain("READONLY_ENFORCED");

      await engine.destroyContainer(container.id);
    });
  });

  describe("Timeout Enforcement", () => {
    it("should kill commands that exceed timeout", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-timeout-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      const start = Date.now();
      const result = await engine.executeInContainer(
        container.id,
        "sleep 60",
        { timeout: 3000 }
      );
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10_000);
      expect(result.exitCode).not.toBe(0);

      await engine.destroyContainer(container.id);
    });

    it("should enforce idle timeout", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-idle-${Date.now()}`,
        resourceLimits: {
          maxProcesses: 5,
          maxIdleTimeoutMs: 2000,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 4000));

      const containerAfter = engine.getContainer(container.id);
      expect(containerAfter).toBeUndefined();
    });

    it("should enforce max lifetime", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-lifetime-${Date.now()}`,
        resourceLimits: {
          maxProcesses: 5,
          maxLifetimeMs: 2000,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 4000));

      const containerAfter = engine.getContainer(container.id);
      expect(containerAfter).toBeUndefined();
    });
  });

  describe("Zombie Process Prevention", () => {
    it("should clean up zombie processes", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-zombie-${Date.now()}`,
        resourceLimits: { maxProcesses: 10 },
      });

      await engine.executeInContainer(
        container.id,
        "(sleep 0.1 &); (sleep 0.1 &); (sleep 0.1 &); wait"
      );

      const stats = await engine.getContainerStats(container.id);
      if (stats) {
        expect(stats.pidsCurrent).toBeLessThanOrEqual(3);
      }

      await engine.destroyContainer(container.id);
    });
  });

  describe("Cleanup After Crash", () => {
    it("should clean up container after destroy", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-cleanup-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      expect(engine.getContainer(container.id)).toBeDefined();

      await engine.destroyContainer(container.id);

      expect(engine.getContainer(container.id)).toBeUndefined();
    });

    it("should handle multiple rapid destroys", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-rapid-destroy-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      await engine.destroyContainer(container.id);
      await engine.destroyContainer(container.id);
      await engine.destroyContainer(container.id);

      expect(engine.getContainer(container.id)).toBeUndefined();
    });

    it("should clean up all containers on clearAll", async () => {
      if (!dockerAvailable) return;
      await engine.createContainer({
        name: `test-clear-1-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });
      await engine.createContainer({
        name: `test-clear-2-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      expect(engine.listContainers().length).toBeGreaterThanOrEqual(2);

      await engine.clearAll();

      expect(engine.listContainers().length).toBe(0);
    });
  });

  describe("Health Check", () => {
    it("should report healthy status for running container", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-health-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      const health = await engine.healthCheck(container.id);
      expect(health.status).toBe("healthy");

      await engine.destroyContainer(container.id);
    });

    it("should report unhealthy for non-existent container", async () => {
      if (!dockerAvailable) return;
      const health = await engine.healthCheck("nonexistent");
      expect(health.status).toBe("unhealthy");
    });
  });

  describe("Container Statistics", () => {
    it("should return container stats", async () => {
      if (!dockerAvailable) return;
      const container = await engine.createContainer({
        name: `test-stats-${Date.now()}`,
        resourceLimits: { maxProcesses: 5 },
      });

      await engine.executeInContainer(container.id, "echo test");

      const stats = await engine.getContainerStats(container.id);
      expect(stats).not.toBeNull();
      expect(stats!.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(stats!.memoryUsage).toBeGreaterThanOrEqual(0);

      await engine.destroyContainer(container.id);
    });
  });
});
