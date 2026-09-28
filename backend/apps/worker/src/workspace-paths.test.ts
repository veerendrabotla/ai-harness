import { describe, expect, it } from "vitest";
import { cloneUrlFor, containerPathFor, hostPathFor, workspaceKey } from "./workspace-paths.js";

const CONTAINER = "/var/lib/ai-harness/workspaces";
const HOST = "C:\\Users\\dev\\project\\.data\\workspaces";

describe("sandbox workspace path mapping", () => {
  it("maps container paths to host paths for docker -v", () => {
    expect(hostPathFor(`${CONTAINER}/abc123`, CONTAINER, HOST)).toBe(
      "C:/Users/dev/project/.data/workspaces/abc123",
    );
  });

  it("maps host paths into the worker container view", () => {
    expect(containerPathFor("C:\\Users\\dev\\project\\.data\\workspaces\\abc123", CONTAINER, HOST)).toBe(
      "/var/lib/ai-harness/workspaces/abc123",
    );
  });

  it("is identity when host and container dirs coincide (local dev)", () => {
    const dir = "/tmp/ai-harness-workspaces";
    expect(hostPathFor(`${dir}/x`, dir, dir)).toBe("/tmp/ai-harness-workspaces/x");
    expect(containerPathFor(`${dir}/x`, dir, dir)).toBe("/tmp/ai-harness-workspaces/x");
  });

  it("leaves paths outside the workspace dir untouched", () => {
    expect(hostPathFor("C:\\other\\path", CONTAINER, HOST)).toBe("C:\\other\\path");
    expect(containerPathFor("/etc/hosts", CONTAINER, HOST)).toBe("/etc/hosts");
    expect(hostPathFor("/var/lib/ai-harness/other", CONTAINER, HOST)).toBe("/var/lib/ai-harness/other");
  });

  it("handles the workspace dir itself (no trailing slash)", () => {
    expect(hostPathFor(CONTAINER, CONTAINER, HOST)).toBe("C:/Users/dev/project/.data/workspaces");
  });

  it("workspace keys are stable and distinct", () => {
    expect(workspaceKey("github.com/e2e/demo")).toBe(workspaceKey("github.com/e2e/demo"));
    expect(workspaceKey("github.com/e2e/demo")).not.toBe(workspaceKey("github.com/e2e/other"));
    expect(workspaceKey("github.com/e2e/demo")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("derives clone URLs only for host/repo-style refs", () => {
    expect(cloneUrlFor("github.com/e2e/demo")).toBe("https://github.com/e2e/demo.git");
    expect(cloneUrlFor("https://github.com/e2e/demo/")).toBe("https://github.com/e2e/demo.git");
    expect(cloneUrlFor("C:\\Users\\dev\\repo")).toBeNull();
    expect(cloneUrlFor("just-a-name")).toBeNull();
    expect(cloneUrlFor("/abs/path/repo")).toBeNull();
  });
});
