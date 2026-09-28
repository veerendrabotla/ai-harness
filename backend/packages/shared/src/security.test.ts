import { describe, expect, it } from "vitest";
import { confinePath } from "./confinement.js";
import { isSafeOutboundUrl } from "./security.js";
import { toolKindForToolName } from "./bridge-protocol.js";

describe("path confinement (FR-015)", () => {
  const root = process.platform === "win32" ? "C:\\projects\\demo" : "/projects/demo";

  it("allows paths inside the root", () => {
    const r = confinePath(root, "src/index.ts");
    expect(r.allowed).toBe(true);
    expect(r.resolved?.toLowerCase()).toContain("demo");
  });

  it("allows '.' and nested relative paths", () => {
    expect(confinePath(root, ".").allowed).toBe(true);
    expect(confinePath(root, "a/b/c.txt").allowed).toBe(true);
  });

  it("rejects traversal in any encoding", () => {
    for (const attempt of ["../outside", "a/../../escape", "..\\..\\x", "..", "x/../.."]) {
      expect(confinePath(root, attempt).allowed, attempt).toBe(false);
    }
  });

  it("rejects absolute paths outside the root", () => {
    const outside =
      process.platform === "win32" ? "C:\\Windows\\system32\\config" : "/etc/passwd";
    expect(confinePath(root, outside).allowed).toBe(false);
  });
});

describe("outbound URL policy guard", () => {
  it("permits public https endpoints", () => {
    expect(isSafeOutboundUrl("https://api.example.com/v1/data").allowed).toBe(true);
    expect(isSafeOutboundUrl("http://example.com").allowed).toBe(true);
  });

  it("blocks private/internal targets (SSRF)", () => {
    for (const url of [
      "http://localhost:8080/admin",
      "http://127.0.0.1/x",
      "http://10.0.0.5/",
      "http://192.168.1.10/router",
      "http://169.254.169.254/latest/meta-data",
      "http://172.16.0.1/",
      "file:///etc/passwd",
      "ftp://example.com/file",
      "not a url",
    ]) {
      expect(isSafeOutboundUrl(url).allowed, url).toBe(false);
    }
  });
});

describe("tool name → bridge kind mapping", () => {
  it("maps every bridge-executable tool", () => {
    expect(toolKindForToolName("filesystem.write")).toBe("fs.write");
    expect(toolKindForToolName("terminal.run_readonly")).toBe("term.ro");
    expect(toolKindForToolName("checkpoint.rollback")).toBe("ckpt.rollback");
  });

  it("returns null for non-bridge tools", () => {
    expect(toolKindForToolName("mcp.call")).toBeNull();
    expect(toolKindForToolName("http.request")).toBeNull();
    expect(toolKindForToolName("unknown.tool")).toBeNull();
  });
});
