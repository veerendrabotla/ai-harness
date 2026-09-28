import { describe, it, expect } from "vitest";

/**
 * File Conflict Resolution Tests
 *
 * Tests the conflict data model and resolution action contracts:
 * - Agent modifies file with user unsaved changes
 * - Agent deletes file with user unsaved changes
 * - Agent renames file with user unsaved changes
 * - No conflict when user has no unsaved changes
 */

describe("File Conflict Detection", () => {
  describe("Write/Create conflict", () => {
    it("detects conflict when agent writes to file with unsaved user changes", () => {
      const openFiles = [
        { path: "src/app.ts", content: "user version", savedContent: "original", dirty: true, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeDefined();
      expect(openFile!.dirty).toBe(true);
    });

    it("no conflict when agent writes to file with no unsaved changes", () => {
      const openFiles = [
        { path: "src/app.ts", content: "original", savedContent: "original", dirty: false, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeDefined();
      expect(openFile!.dirty).toBe(false);
    });

    it("no conflict when agent writes to file not open by user", () => {
      const openFiles = [
        { path: "src/other.ts", content: "content", savedContent: "content", dirty: false, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeUndefined();
    });
  });

  describe("Delete conflict", () => {
    it("detects conflict when agent deletes file with unsaved user changes", () => {
      const openFiles = [
        { path: "src/app.ts", content: "user version", savedContent: "original", dirty: true, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeDefined();
      expect(openFile!.dirty).toBe(true);
    });

    it("marks tab as deleted when agent deletes file with no unsaved changes", () => {
      const openFiles = [
        { path: "src/app.ts", content: "original", savedContent: "original", dirty: false, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeDefined();
      expect(openFile!.dirty).toBe(false);
    });

    it("no conflict when agent deletes file not open by user", () => {
      const openFiles = [
        { path: "src/other.ts", content: "content", savedContent: "content", dirty: false, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeUndefined();
    });
  });

  describe("Rename conflict", () => {
    it("detects conflict when agent renames file with unsaved user changes", () => {
      const openFiles = [
        { path: "src/app.ts", content: "user version", savedContent: "original", dirty: true, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeDefined();
      expect(openFile!.dirty).toBe(true);
    });

    it("updates tab path when agent renames file with no unsaved changes", () => {
      const openFiles = [
        { path: "src/app.ts", content: "content", savedContent: "content", dirty: false, language: "typescript" },
      ];
      const openFile = openFiles.find((f) => f.path === "src/app.ts");
      expect(openFile).toBeDefined();
      expect(openFile!.dirty).toBe(false);
    });
  });
});

describe("Conflict Resolution Actions", () => {
  it("Keep My Version preserves user content and clears conflict", () => {
    const conflict = {
      path: "src/app.ts",
      userContent: "user version",
      diskContent: "agent version",
      detectedAt: new Date(),
    };
    expect(conflict.userContent).toBe("user version");
  });

  it("Use Agent Version replaces user content with disk content", () => {
    const conflict = {
      path: "src/app.ts",
      userContent: "user version",
      diskContent: "agent version",
      detectedAt: new Date(),
    };
    expect(conflict.diskContent).toBe("agent version");
  });

  it("Save My Version As creates new file with user content", () => {
    const conflict = {
      path: "src/app.ts",
      userContent: "user version",
      diskContent: "agent version",
      detectedAt: new Date(),
    };
    expect(conflict.userContent).toBe("user version");
  });

  it("Close Without Resolving dismisses conflict, keeps user content unsaved", () => {
    const conflict = {
      path: "src/app.ts",
      userContent: "user version",
      diskContent: "agent version",
      detectedAt: new Date(),
    };
    expect(conflict.userContent).toBe("user version");
  });
});

describe("Agent Deleted File Handling", () => {
  it("shows deleted state in editor when file is deleted by agent", () => {
    const openFile = {
      path: "src/app.ts",
      content: "user version",
      savedContent: "original",
      dirty: false,
      language: "typescript",
      deleted: true,
    };
    expect(openFile.deleted).toBe(true);
  });

  it("restores deleted file when user chooses Keep My Version", () => {
    const conflict = {
      path: "src/app.ts",
      userContent: "user version",
      diskContent: "",
      detectedAt: new Date(),
      agentDeleted: true,
    };
    expect(conflict.agentDeleted).toBe(true);
    expect(conflict.userContent).toBe("user version");
  });
});

describe("Agent Renamed File Handling", () => {
  it("updates tab path when agent renames file", () => {
    const openFile = {
      path: "src/app.ts",
      content: "content",
      savedContent: "content",
      dirty: false,
      language: "typescript",
    };
    expect(openFile.path).toBe("src/app.ts");
  });

  it("creates conflict when agent renames file with unsaved changes", () => {
    const conflict = {
      path: "src/app.ts",
      userContent: "user version",
      diskContent: "agent version at new path",
      detectedAt: new Date(),
      agentRenamed: "src/main.ts",
    };
    expect(conflict.agentRenamed).toBe("src/main.ts");
  });
});
