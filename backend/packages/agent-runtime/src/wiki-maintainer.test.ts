import { describe, expect, it, vi } from "vitest";
import {
  MAX_CHANGELOG_ENTRIES,
  WIKI_CHANGELOG_PATH,
  WIKI_INDEX_PATH,
  WIKI_PAGES_DIR,
  WikiMaintainer,
  buildIndex,
  buildRunEntry,
  extractListNames,
  extractReadText,
  isWikiPath,
  mergeChangelog,
  type WikiDeps,
  type WikiRunFacts,
} from "./wiki-maintainer.js";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

function facts(over: Partial<WikiRunFacts> = {}): WikiRunFacts {
  return {
    runId: "run-12345678-abcd",
    goal: "Add retry logic",
    completedAt: new Date("2026-10-02T10:00:00.000Z"),
    stepCount: 3,
    verificationPassed: 2,
    verificationTotal: 2,
    affectedFiles: ["src/a.ts", "src/b.ts"],
    ...over,
  };
}

function fakeDeps(over: Partial<WikiDeps> = {}) {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const base: WikiDeps = {
    async getProject() {
      return { name: "Demo", rootReference: "/repo", environment: "LOCAL_BRIDGE" };
    },
    async getRunFacts(_taskId, runId) {
      return facts({ runId });
    },
    async getRecentRuns() {
      return [{ completedAt: new Date("2026-10-01T09:00:00.000Z"), goal: "Earlier run" }];
    },
    async listWiki(_w, path) {
      // Mirror `ls`: immediate children only, directories included as names.
      const kids = new Set(
        [...files.keys()]
          .filter((k) => k.startsWith(`${path}/`))
          .map((k) => k.slice(path.length + 1).split("/")[0]!),
      );
      return [...kids];
    },
    async readWiki(_w, path) {
      return files.get(path) ?? null;
    },
    async writeWiki(_w, path, content) {
      files.set(path, content);
      writes.push(path);
    },
    ...over,
  };
  return { deps: base, files, writes };
}

describe("isWikiPath", () => {
  it("accepts the wiki dir and children, including backslashes", () => {
    expect(isWikiPath(".aiharness/wiki")).toBe(true);
    expect(isWikiPath(".aiharness/wiki/index.md")).toBe(true);
    expect(isWikiPath(".aiharness\\wiki\\pages\\a.md")).toBe(true);
  });

  it("rejects non-wiki paths and traversal segments", () => {
    expect(isWikiPath(undefined)).toBe(false);
    expect(isWikiPath("src/index.ts")).toBe(false);
    expect(isWikiPath(".aiharness/wikifoo")).toBe(false);
    expect(isWikiPath(".aiharness/wiki/../secrets.md")).toBe(false);
    expect(isWikiPath("../.aiharness/wiki/a.md")).toBe(false);
  });
});

describe("buildRunEntry", () => {
  it("renders marker, heading, stats and touched files", () => {
    const entry = buildRunEntry(facts());
    expect(entry).toContain("<!-- run:run-12345678-abcd -->");
    expect(entry).toContain("## 2026-10-02 — Add retry logic");
    expect(entry).toContain("Run `run-1234` · 3 step(s) · verification 2/2 passed");
    expect(entry).toContain("Touched: `src/a.ts`, `src/b.ts`");
  });

  it("caps listed files at 5 with a more-note and omits the line when empty", () => {
    const many = buildRunEntry(facts({ affectedFiles: ["1", "2", "3", "4", "5", "6", "7"] }));
    expect(many).toContain("+2 more");
    expect(many).not.toContain("`6`");
    const none = buildRunEntry(facts({ affectedFiles: [] }));
    expect(none).not.toContain("Touched:");
  });

  it("flattens and truncates hostile goals", () => {
    const entry = buildRunEntry(facts({ goal: `line1\n## injected\n${"x".repeat(200)}` }));
    const lines = entry.split("\n");
    expect(lines[1]).not.toContain("\n");
    expect(lines.some((l) => l.trim().startsWith("## injected"))).toBe(false);
    expect(lines[1]!.length).toBeLessThan(140);
  });
});

describe("mergeChangelog", () => {
  it("creates a headered document from null", () => {
    const merged = mergeChangelog(null, buildRunEntry(facts()));
    expect(merged.startsWith("# Changelog")).toBe(true);
    expect(merged).toContain("<!-- run:run-12345678-abcd -->");
  });

  it("prepends newest entries first", () => {
    const first = mergeChangelog(null, buildRunEntry(facts({ runId: "run-old", goal: "Old" })));
    const second = mergeChangelog(first, buildRunEntry(facts({ runId: "run-new", goal: "New" })));
    expect(second.indexOf("run-new")).toBeLessThan(second.indexOf("run-old"));
    expect(second).toContain("# Changelog");
  });

  it("is idempotent per run id", () => {
    const entry = buildRunEntry(facts());
    const first = mergeChangelog(null, entry);
    expect(mergeChangelog(first, entry)).toBe(first);
  });

  it("caps the changelog at MAX_CHANGELOG_ENTRIES, dropping the oldest", () => {
    let doc = mergeChangelog(null, buildRunEntry(facts({ runId: "run-0", goal: "seed" })));
    for (let i = 1; i <= MAX_CHANGELOG_ENTRIES + 15; i++) {
      doc = mergeChangelog(doc, buildRunEntry(facts({ runId: `run-${i}`, goal: `Goal ${i}` })));
    }
    const markers = doc.match(/<!-- run:/g) ?? [];
    expect(markers).toHaveLength(MAX_CHANGELOG_ENTRIES);
    expect(doc).toContain("run-65");
    expect(doc).not.toContain("<!-- run:run-0 -->");
    expect(doc).not.toContain("<!-- run:run-15 -->");
    expect(doc).toContain("# Changelog");
  });
});

describe("buildIndex", () => {
  const input = {
    projectName: "Demo",
    pages: ["architecture.md", "data-model.md"],
    recentRuns: [{ completedAt: new Date("2026-10-01T09:00:00.000Z"), goal: "Earlier run" }],
    lastRunId: "run-12345678-abcd",
    lastRunAt: new Date("2026-10-02T10:00:00.000Z"),
  };

  it("renders project title, sorted page links and the runs table", () => {
    const index = buildIndex(input);
    expect(index).toContain("# Demo wiki");
    expect(index).toContain(`- [architecture](${WIKI_PAGES_DIR}/architecture.md)`);
    expect(index.indexOf("architecture")).toBeLessThan(index.indexOf("data-model"));
    expect(index).toContain("| 2026-10-01 | Earlier run |");
    expect(index).toContain("(run `run-1234`)");
  });

  it("shows an empty state for no pages and escapes pipes in goals", () => {
    const index = buildIndex({ ...input, pages: [], recentRuns: [{ completedAt: new Date(), goal: "a | b" }] });
    expect(index).toContain("No topic pages yet");
    expect(index).toContain("a \\| b");
  });

  it("filters non-markdown entries from the page list", () => {
    const index = buildIndex({ ...input, pages: ["notes.txt", "ok.md"] });
    expect(index).not.toContain("notes.txt");
    expect(index).toContain("ok.md");
  });
});

describe("WikiMaintainer.maintain", () => {
  const input = { projectId: "p1", taskId: "t1", runId: "run-12345678-abcd", payload: {} };

  it("skips when the project does not exist", async () => {
    const { deps, writes } = fakeDeps({ async getProject() { return null; } });
    const m = new WikiMaintainer(deps, logger as never);
    expect(await m.maintain(input)).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("skips (opt-in) when .aiharness/wiki/ does not exist", async () => {
    const { deps, writes } = fakeDeps();
    const m = new WikiMaintainer(deps, logger as never);
    expect(await m.maintain(input)).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("writes changelog + index when the wiki exists", async () => {
    const { deps, files, writes } = fakeDeps();
    files.set(".aiharness/wiki/pages/.keep", "x"); // establishes presence
    const m = new WikiMaintainer(deps, logger as never);
    const written = await m.maintain(input);
    expect(written).toEqual([WIKI_CHANGELOG_PATH, WIKI_INDEX_PATH]);
    expect(writes).toEqual([WIKI_CHANGELOG_PATH, WIKI_INDEX_PATH]);
    expect(files.get(WIKI_CHANGELOG_PATH)).toContain("run-12345678-abcd");
    expect(files.get(WIKI_INDEX_PATH)).toContain("# Demo wiki");
  });

  it("lists topic pages into the index", async () => {
    const { deps, files } = fakeDeps();
    files.set(".aiharness/wiki/pages/.keep", "x");
    files.set(`${WIKI_PAGES_DIR}/architecture.md`, "# Architecture");
    const m = new WikiMaintainer(deps, logger as never);
    await m.maintain(input);
    expect(files.get(WIKI_INDEX_PATH)).toContain(`(${WIKI_PAGES_DIR}/architecture.md)`);
  });

  it("does not rewrite the changelog for an already-recorded run (index still refreshes)", async () => {
    const { deps, files, writes } = fakeDeps();
    files.set(".aiharness/wiki/pages/.keep", "x");
    const m = new WikiMaintainer(deps, logger as never);
    await m.maintain(input);
    writes.length = 0;
    const written = await m.maintain(input);
    expect(written).toEqual([WIKI_INDEX_PATH]);
    expect(writes).toEqual([WIKI_INDEX_PATH]);
    expect(files.get(WIKI_CHANGELOG_PATH)!.match(/<!-- run:run-12345678-abcd -->/g)).toHaveLength(1);
  });

  it("skips when run facts cannot be gathered", async () => {
    const { deps, files, writes } = fakeDeps({
      async getRunFacts() { return null; },
    });
    files.set(".aiharness/wiki/pages/.keep", "x");
    const m = new WikiMaintainer(deps, logger as never);
    expect(await m.maintain(input)).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("maintainFromHook logs and swallows write failures", async () => {
    const { deps, files } = fakeDeps({
      async writeWiki() { throw new Error("bridge offline"); },
    });
    files.set(".aiharness/wiki/pages/.keep", "x");
    const m = new WikiMaintainer(deps, logger as never);
    await expect(
      m.maintainFromHook({ taskId: "t1", runId: "r1", projectId: "p1", workspaceId: "w1", event: "afterComplete", payload: {} }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("retries a timed-out maintenance write once before giving up", async () => {
    const { deps, files } = fakeDeps();
    files.set(".aiharness/wiki/pages/.keep", "x");
    let calls = 0;
    const inner = deps.writeWiki;
    deps.writeWiki = async (w, path, content) => {
      calls++;
      if (calls === 1) throw new Error("Tool exceeded timeout of 30000ms");
      return inner(w, path, content);
    };
    const m = new WikiMaintainer(deps, logger as never);
    const written = await m.maintain(input);
    expect(written).toEqual([WIKI_CHANGELOG_PATH, WIKI_INDEX_PATH]);
    expect(calls).toBe(3); // changelog failed once, retried OK, then index
    expect(files.get(WIKI_INDEX_PATH)).toContain("# Demo wiki");
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "wiki write failed; retrying once");
  });

  it("still refreshes the index when the recent-runs query fails", async () => {
    const { deps, files } = fakeDeps({
      async getRecentRuns() { throw new Error("Can't reach database server"); },
    });
    files.set(".aiharness/wiki/pages/.keep", "x");
    const m = new WikiMaintainer(deps, logger as never);
    const written = await m.maintain(input);
    expect(written).toEqual([WIKI_CHANGELOG_PATH, WIKI_INDEX_PATH]);
    expect(files.get(WIKI_INDEX_PATH)).toContain("No completed runs yet");
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "wiki recent-runs query failed");
  });

  it("does not read a first-run changelog the presence listing lacks", async () => {
    const { deps, files } = fakeDeps();
    files.set(".aiharness/wiki/pages/.keep", "x"); // presence, but no changelog.md yet
    const readWiki = vi.spyOn(deps, "readWiki");
    const m = new WikiMaintainer(deps, logger as never);
    expect(await m.maintain(input)).toEqual([WIKI_CHANGELOG_PATH, WIKI_INDEX_PATH]);
    expect(readWiki).not.toHaveBeenCalled();
  });
});

describe("executor output normalization", () => {
  it("extracts bridge fs.list entries", () => {
    expect(extractListNames({ entries: [{ name: "index.md", type: "file" }, { name: "pages", type: "dir" }] }))
      .toEqual(["index.md", "pages"]);
  });

  it("extracts sandbox ls -la names", () => {
    const ls = [
      "total 8",
      "drwxr-xr-x 2 root root 4096 Oct  2 10:00 .",
      "drwxr-xr-x 3 root root 4096 Oct  2 10:00 ..",
      "-rw-r--r-- 1 root root  120 Oct  2 10:00 index.md",
      "drwxr-xr-x 2 root root 4096 Oct  2 10:00 pages",
    ].join("\n");
    expect(extractListNames({ output: ls, exitCode: 0 })).toEqual(["index.md", "pages"]);
  });

  it("returns empty for unknown shapes", () => {
    expect(extractListNames({})).toEqual([]);
    expect(extractListNames({ output: 42 })).toEqual([]);
  });

  it("extracts read text from both executor shapes", () => {
    expect(extractReadText({ content: "bridge", sizeBytes: 5 })).toBe("bridge");
    expect(extractReadText({ output: "sandbox", exitCode: 0 })).toBe("sandbox");
    expect(extractReadText({ other: true })).toBeNull();
  });
});
