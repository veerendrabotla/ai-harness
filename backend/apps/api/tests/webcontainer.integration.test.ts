import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const API_BASE = process.env.API_URL ?? "http://localhost:4000";

let authToken = "";
let workspaceId = "";
let serverAvailable = false;

async function apiRequest(path: string, options: RequestInit = {}) {
  const url = new URL(path, API_BASE);
  const response = await fetch(url, {
    ...options,
    headers: {
      // Only declare a JSON body when one is actually sent — Fastify rejects
      // content-type json with an empty body (400 FST_ERR_CTP_EMPTY_JSON_BODY).
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
  return response;
}

// Probed at module load (collection time): describe.skipIf conditions are
// evaluated during collection, before beforeAll hooks would ever run.
try {
  const health = await apiRequest("/v1/health");
  serverAvailable = health.ok;
} catch {
  serverAvailable = false;
}

beforeAll(async () => {
  if (!serverAvailable) return;

  const registerRes = await apiRequest("/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: `wc-test-${Date.now()}@example.com`,
      password: "Testpass123!",
      displayName: "WebContainer Test User",
    }),
  });

  if (registerRes.ok) {
    const data = await registerRes.json();
    authToken = data?.data?.accessToken ?? "";
  }

  if (authToken) {
    // Create routes enforce workspace membership — create a real workspace.
    const wsRes = await apiRequest("/v1/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "WebContainer Test Workspace" }),
    });
    if (wsRes.ok) {
      const ws = await wsRes.json();
      workspaceId = ws?.data?.id ?? "";
    }
  }
});

afterAll(() => {
  authToken = "";
});

const d = describe.skipIf(!serverAvailable);

d("WebContainer Integration Tests", () => {
  let sessionId = "";

  it("creates a new WebContainer session", async () => {
    const res = await apiRequest("/v1/webcontainer/create", {
      method: "POST",
      body: JSON.stringify({ workspaceId }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    sessionId = data?.data?.sessionId ?? "";
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe("string");
  });

  it("syncs files to the container", async () => {
    const files = {
      "index.ts": "console.log('hello');",
      "package.json": JSON.stringify({ name: "test" }),
    };

    const res = await apiRequest(`/v1/webcontainer/${sessionId}/files`, {
      method: "POST",
      body: JSON.stringify(files),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.synced).toBe(2);
  });

  it("executes a command in the container", async () => {
    const res = await apiRequest(`/v1/webcontainer/${sessionId}/run`, {
      method: "POST",
      body: JSON.stringify({ command: "echo hello" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.exitCode).toBe(0);
  });

  it("gets container status", async () => {
    const res = await apiRequest(`/v1/webcontainer/${sessionId}/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.status).toBeDefined();
    expect(data?.data?.fileCount).toBeGreaterThanOrEqual(0);
  });

  it("shuts down the container", async () => {
    const res = await apiRequest(`/v1/webcontainer/${sessionId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.success).toBe(true);
  });

  it("returns 404 for non-existent container", async () => {
    const res = await apiRequest(`/v1/webcontainer/${randomUUID()}/status`);
    expect(res.status).toBe(404);
  });

  it("validates missing workspaceId in create request", async () => {
    const res = await apiRequest("/v1/webcontainer/create", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([400, 422]).toContain(res.status);
  });
});
