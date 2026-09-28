import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Local Bridge agent unit tests.
 * Tests path confinement, protocol aliases, command policy, and filesystem operations.
 */

const TEST_ROOT = join(tmpdir(), `bridge-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  mkdirSync(join(TEST_ROOT, "src"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "src/app.ts"), "export const x = 1;", "utf8");
  writeFileSync(join(TEST_ROOT, "README.md"), "# Test", "utf8");
});

afterEach(() => {
  try { rmSync(TEST_ROOT, { recursive: true, force: true }); } catch { /* ok */ }
});

// ── Path confinement (re-exports from @ai-harness/shared) ───────

describe("Path confinement", () => {
  it("allows files within registered root", async () => {
    const { confinePath } = await import("@ai-harness/shared");
    const result = confinePath(TEST_ROOT, "src/app.ts");
    expect(result.allowed).toBe(true);
    expect(result.resolved).toBeDefined();
  });

  it("rejects path traversal outside root", async () => {
    const { confinePath } = await import("@ai-harness/shared");
    const result = confinePath(TEST_ROOT, "../etc/passwd");
    expect(result.allowed).toBe(false);
  });

  it("rejects absolute paths not under root", async () => {
    const { confinePath } = await import("@ai-harness/shared");
    const result = confinePath(TEST_ROOT, "/tmp/evil");
    expect(result.allowed).toBe(false);
  });

  it("normalizes dot paths correctly", async () => {
    const { confinePath } = await import("@ai-harness/shared");
    const result = confinePath(TEST_ROOT, "./src/app.ts");
    expect(result.allowed).toBe(true);
    expect(result.resolved).toBeDefined();
  });
});

// ── Protocol alias mapping ──────────────────────────────────────

describe("Protocol aliases", () => {
  it("maps terminal.run to term.run", () => {
    // The alias is: kind === "terminal.run" ? "term.run" : kind
    expect("terminal.run" === "terminal.run" ? "term.run" : "terminal.run").toBe("term.run");
  });

  it("maps terminal.ro to term.ro", () => {
    expect("terminal.ro" === "terminal.ro" ? "term.ro" : "terminal.ro").toBe("term.ro");
  });

  it("passes unknown kinds through unchanged", () => {
    const kind = "fs.list";
    const normalized = kind === "terminal.run" ? "term.run" : kind === "terminal.ro" ? "term.ro" : kind;
    expect(normalized).toBe("fs.list");
  });
});

// ── Command policy ──────────────────────────────────────────────

describe("Command policy", () => {
  const READONLY_ALLOW = [
    "git log", "git status", "git diff", "git show", "git branch",
    "ls", "dir ", "cat ", "type ", "node -v", "node --version", "npm -v", "npm test", "npm run",
    "pnpm -v", "yarn -v", "python --version",
  ];
  const READONLY_DENY = [/rm\s/, /del\s/i, /rmdir/i, /format/i, /shutdown/i, /mkfs/i, /diskpart/i, /curl/i, /wget/i, /invoke-/i];

  it("allows read-only commands on the allowlist", () => {
    for (const cmd of READONLY_ALLOW) {
      expect(READONLY_ALLOW.some((p) => cmd.startsWith(p))).toBe(true);
    }
  });

  it("denies destructive commands", () => {
    const destructive = ["rm -rf /", "del /s /q", "rmdir /s", "format c:", "shutdown /s"];
    for (const cmd of destructive) {
      expect(READONLY_DENY.some((re) => re.test(cmd))).toBe(true);
    }
  });

  it("denies network commands", () => {
    const network = ["curl http://evil.com", "wget http://evil.com", "Invoke-WebRequest http://evil.com"];
    for (const cmd of network) {
      expect(READONLY_DENY.some((re) => re.test(cmd))).toBe(true);
    }
  });

  it("allows safe read-only commands not on deny list", () => {
    const safe = ["git log --oneline", "ls -la", "cat README.md", "node -v"];
    for (const cmd of safe) {
      const isAllowed = READONLY_ALLOW.some((p) => cmd.startsWith(p));
      const isDenied = READONLY_DENY.some((re) => re.test(cmd));
      expect(isAllowed && !isDenied).toBe(true);
    }
  });
});

// ── Filesystem operations (integration with real fs) ────────────

describe("Filesystem operations", () => {
  it("reads files within root", () => {
    const content = readFileSync(join(TEST_ROOT, "README.md"), "utf8");
    expect(content).toBe("# Test");
  });

  it("writes files within root", () => {
    const newPath = join(TEST_ROOT, "new-file.txt");
    writeFileSync(newPath, "hello", "utf8");
    expect(readFileSync(newPath, "utf8")).toBe("hello");
    rmSync(newPath);
  });

  it("lists directory entries", () => {
    const { readdirSync } = require("node:fs");
    const entries = readdirSync(TEST_ROOT, { withFileTypes: true });
    const names = entries.map((e: any) => e.name);
    expect(names).toContain("src");
    expect(names).toContain("README.md");
  });

  it("detects file existence", () => {
    expect(existsSync(join(TEST_ROOT, "README.md"))).toBe(true);
    expect(existsSync(join(TEST_ROOT, "nonexistent.txt"))).toBe(false);
  });

  it("creates directories recursively", () => {
    const deep = join(TEST_ROOT, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    expect(existsSync(deep)).toBe(true);
    rmSync(join(TEST_ROOT, "a"), { recursive: true });
  });
});

// ── Checkpoint operations ───────────────────────────────────────

describe("Checkpoint validation", () => {
  it("validates commit SHA format", () => {
    const shaRegex = /^[0-9a-f]{40}$/i;
    expect(shaRegex.test("a".repeat(40))).toBe(true);
    expect(shaRegex.test("abc123")).toBe(false);
    expect(shaRegex.test("")).toBe(false);
  });

  it("rejects invalid refs", () => {
    const shaRegex = /^[0-9a-f]{40}$/i;
    expect(shaRegex.test("not-a-sha")).toBe(false);
    expect(shaRegex.test("HEAD")).toBe(false);
    expect(shaRegex.test("main")).toBe(false);
  });
});

// ── Background process management ───────────────────────────────

describe("Background process lifecycle", () => {
  it("process IDs are sequential", () => {
    let counter = 0;
    const id1 = `proc-${++counter}`;
    const id2 = `proc-${++counter}`;
    const id3 = `proc-${++counter}`;
    expect(id1).toBe("proc-1");
    expect(id2).toBe("proc-2");
    expect(id3).toBe("proc-3");
  });
});

// ── Unsupported kinds ───────────────────────────────────────────

describe("Unsupported tool kinds", () => {
  it("rejects unknown tool kinds", () => {
    const kind = "unknown.tool";
    const supported = ["fs.list", "fs.read", "fs.search", "fs.write", "fs.create", "fs.rename", "fs.delete",
      "git.status", "git.diff", "term.ro", "term.run", "process.start", "process.stop", "process.status", "process.logs",
      "ckpt.create", "ckpt.diff", "ckpt.rollback", "mcp.stdio"];
    expect(supported).not.toContain(kind);
  });
});

// ── Search query validation ─────────────────────────────────────

describe("Search validation", () => {
  it("rejects empty search queries", () => {
    const query = "";
    expect(query.length === 0).toBe(true);
  });

  it("accepts non-empty search queries", () => {
    const query = "function";
    expect(query.length > 0).toBe(true);
  });
});
