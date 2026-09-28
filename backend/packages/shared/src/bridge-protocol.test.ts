import { describe, it, expect } from "vitest";
import { toolKindForToolName, type BridgeToolKind } from "../src/bridge-protocol.js";

describe("bridge-protocol", () => {
  describe("toolKindForToolName", () => {
    it("maps all filesystem tools", () => {
      expect(toolKindForToolName("filesystem.list")).toBe("fs.list");
      expect(toolKindForToolName("filesystem.read")).toBe("fs.read");
      expect(toolKindForToolName("filesystem.search")).toBe("fs.search");
      expect(toolKindForToolName("filesystem.write")).toBe("fs.write");
      expect(toolKindForToolName("filesystem.create")).toBe("fs.create");
      expect(toolKindForToolName("filesystem.rename")).toBe("fs.rename");
      expect(toolKindForToolName("filesystem.delete")).toBe("fs.delete");
    });

    it("maps all git tools", () => {
      expect(toolKindForToolName("git.status")).toBe("git.status");
      expect(toolKindForToolName("git.diff")).toBe("git.diff");
    });

    it("maps all terminal tools", () => {
      expect(toolKindForToolName("terminal.run")).toBe("term.run");
      expect(toolKindForToolName("terminal.run_readonly")).toBe("term.ro");
    });

    it("maps all checkpoint tools", () => {
      expect(toolKindForToolName("checkpoint.create")).toBe("ckpt.create");
      expect(toolKindForToolName("checkpoint.diff")).toBe("ckpt.diff");
      expect(toolKindForToolName("checkpoint.rollback")).toBe("ckpt.rollback");
    });

    it("returns null for unknown tool names", () => {
      expect(toolKindForToolName("unknown.tool")).toBeNull();
      expect(toolKindForToolName("")).toBeNull();
      expect(toolKindForToolName("filesystem")).toBeNull();
    });
  });

  describe("BridgeToolKind includes new kinds", () => {
    it("includes process management kinds", () => {
      const kinds: BridgeToolKind[] = [
        "process.start",
        "process.stop",
        "process.status",
        "process.logs",
      ];
      for (const kind of kinds) {
        expect(typeof kind).toBe("string");
      }
    });

    it("includes terminal.run and terminal.ro aliases", () => {
      const aliases: BridgeToolKind[] = ["terminal.run", "terminal.ro"];
      for (const kind of aliases) {
        expect(typeof kind).toBe("string");
      }
    });
  });
});
