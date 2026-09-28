import { describe, it, expect, beforeEach } from "vitest";
import { ConflictResolutionEngine } from "./conflict-engine.js";

describe("ConflictResolutionEngine", () => {
  let engine: ConflictResolutionEngine;

  beforeEach(() => {
    engine = new ConflictResolutionEngine();
  });

  describe("Conflict Detection", () => {
    it("should detect file conflicts", () => {
      const result = engine.detectConflict(
        "test.ts",
        "old content",
        "new content"
      );
      expect(result.hasConflict).toBe(true);
      expect(result.conflicts.length).toBe(1);
    });

    it("should not detect conflict for identical content", () => {
      const result = engine.detectConflict(
        "test.ts",
        "same content",
        "same content"
      );
      expect(result.hasConflict).toBe(false);
    });

    it("should detect merge conflicts", () => {
      const content = `<<<<<<<
current code
=======
incoming code
>>>>>>>`;
      const result = engine.detectMergeConflicts(content);
      expect(result.hasConflict).toBe(true);
    });
  });

  describe("Conflict Resolution", () => {
    it("should resolve with accept_current", async () => {
      const result = engine.detectConflict("test.ts", "current", "incoming");
      const conflict = result.conflicts[0]!;

      const resolution = await engine.resolve(
        conflict.id,
        "accept_current",
        "user-1"
      );

      expect(resolution.resolvedContent).toBe("current");
      expect(resolution.strategy).toBe("accept_current");
    });

    it("should resolve with accept_incoming", async () => {
      const result = engine.detectConflict("test.ts", "current", "incoming");
      const conflict = result.conflicts[0]!;

      const resolution = await engine.resolve(
        conflict.id,
        "accept_incoming",
        "user-1"
      );

      expect(resolution.resolvedContent).toBe("incoming");
    });

    it("should resolve with manual content", async () => {
      const result = engine.detectConflict("test.ts", "current", "incoming");
      const conflict = result.conflicts[0]!;

      const resolution = await engine.resolve(
        conflict.id,
        "manual",
        "user-1",
        "resolved content"
      );

      expect(resolution.resolvedContent).toBe("resolved content");
    });

    it("should fail to resolve non-existent conflict", async () => {
      await expect(
        engine.resolve("nonexistent", "accept_current", "user-1")
      ).rejects.toThrow("not found");
    });
  });

  describe("Hunk Parsing", () => {
    it("should parse conflict hunks", () => {
      const content = `line 1
<<<<<<<
current line
=======
incoming line
>>>>>>>`;
      const hunks = engine.parseConflictHunks(content);
      expect(hunks.length).toBe(1);
    });
  });

  describe("Conflict Management", () => {
    it("should list unresolved conflicts", () => {
      engine.detectConflict("a.ts", "a1", "a2");
      engine.detectConflict("b.ts", "b1", "b2");

      expect(engine.getUnresolvedConflicts().length).toBe(2);
    });

    it("should clear resolved conflicts", async () => {
      const result = engine.detectConflict("test.ts", "current", "incoming");
      await engine.resolve(result.conflicts[0]!.id, "accept_current", "user-1");

      engine.clearResolved();
      expect(engine.getResolvedConflicts().length).toBe(0);
    });
  });
});
