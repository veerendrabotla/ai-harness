import { describe, it, expect, beforeEach } from "vitest";
import { SandboxEngine } from "./engine.js";

describe("SandboxEngine", () => {
  let engine: SandboxEngine;

  beforeEach(() => {
    engine = new SandboxEngine();
    engine.clearAll();
  });

  describe("createSandbox", () => {
    it("should create a sandbox with a unique ID", async () => {
      const sandbox = await engine.createSandbox({ name: "test-sandbox" });
      expect(sandbox.id).toBeDefined();
      expect(sandbox.name).toBe("test-sandbox");
      expect(sandbox.status).toBe("ready");
      expect(sandbox.rootDir).toBeDefined();
    });

    it("should create multiple sandboxes", async () => {
      const s1 = await engine.createSandbox({ name: "sandbox-1" });
      const s2 = await engine.createSandbox({ name: "sandbox-2" });
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe("getSandbox", () => {
    it("should return a sandbox by ID", async () => {
      const created = await engine.createSandbox({ name: "test" });
      const found = engine.getSandbox(created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it("should return undefined for non-existent sandbox", () => {
      const found = engine.getSandbox("non-existent");
      expect(found).toBeUndefined();
    });
  });

  describe("listSandboxes", () => {
    it("should list all sandboxes", async () => {
      await engine.createSandbox({ name: "s1" });
      await engine.createSandbox({ name: "s2" });
      const list = engine.listSandboxes();
      expect(list.length).toBe(2);
    });
  });

  describe("writeFile and readFile", () => {
    it("should write and read a file", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "test.txt", "hello world");
      const content = await engine.readFile(sandbox.id, "test.txt");
      expect(content).toBe("hello world");
    });

    it("should create nested directories", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "src/index.ts", "console.log('hi')");
      const content = await engine.readFile(sandbox.id, "src/index.ts");
      expect(content).toBe("console.log('hi')");
    });
  });

  describe("listFiles", () => {
    it("should list files in a directory", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "file1.txt", "content1");
      await engine.writeFile(sandbox.id, "file2.txt", "content2");
      await engine.writeFile(sandbox.id, "sub/nested.txt", "nested");

      const files = await engine.listFiles(sandbox.id, ".");
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some((f) => f.name === "file1.txt")).toBe(true);
      expect(files.some((f) => f.name === "file2.txt")).toBe(true);
    });
  });

  describe("deletePath", () => {
    it("should delete a file", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "delete-me.txt", "content");
      await engine.deletePath(sandbox.id, "delete-me.txt");
      await expect(engine.readFile(sandbox.id, "delete-me.txt")).rejects.toThrow();
    });
  });

  describe("execute", () => {
    it("should execute a simple command", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      const result = await engine.execute(sandbox.id, "echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
    });

    it("should return exit code for failed commands", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      const result = await engine.execute(sandbox.id, "exit 1");
      expect(result.exitCode).toBe(1);
    });

    it("should execute commands in a specific directory", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "sub/file.txt", "content");
      const read = process.platform === "win32" ? "type file.txt" : "cat file.txt";
      const result = await engine.execute(sandbox.id, read, { cwd: "sub" });
      expect(result.stdout).toContain("content");
    });
  });

  describe("installDependencies", () => {
    it("should install dependencies", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "package.json", JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        dependencies: {},
      }));
      const result = await engine.installDependencies(sandbox.id);
      expect(result.exitCode).toBe(0);
      // Spawns a real `npm install` subprocess; under full-suite parallel load
      // (docker isolation tests saturating CPU/disk) this exceeds the global
      // 15s testTimeout even though it runs in ~4s in isolation.
    }, 60_000);
  });

  describe("build", () => {
    it("should run a build command", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "package.json", JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        scripts: { build: "echo building..." },
      }));
      const result = await engine.build(sandbox.id);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("building...");
    });
  });

  describe("destroySandbox", () => {
    it("should destroy a sandbox", async () => {
      const sandbox = await engine.createSandbox({ name: "test" });
      await engine.writeFile(sandbox.id, "file.txt", "content");
      await engine.destroySandbox(sandbox.id);
      expect(engine.getSandbox(sandbox.id)).toBeUndefined();
    });

    it("should handle destroying non-existent sandbox", async () => {
      await expect(engine.destroySandbox("non-existent")).resolves.not.toThrow();
    });
  });
});
