import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const API_BASE = process.env.API_URL ?? "http://localhost:4000";

let authToken = "";
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
      email: `mp-test-${Date.now()}@example.com`,
      password: "Testpass123!",
      displayName: "Multiplayer Test User",
    }),
  });

  if (registerRes.ok) {
    const data = await registerRes.json();
    authToken = data?.data?.accessToken ?? "";
  }
});

afterAll(() => {
  authToken = "";
});

const d = describe.skipIf(!serverAvailable);

d("Multiplayer Integration Tests", () => {
  const taskId = randomUUID();

  it("joins a multiplayer session", async () => {
    const res = await apiRequest(`/v1/multiplayer/${taskId}/join`, {
      method: "POST",
      // Fastify rejects content-type json with an empty body (400).
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.taskId).toBe(taskId);
    expect(data?.data?.userId).toBeDefined();
    expect(data?.data?.wsUrl).toContain(taskId);
  });

  it("lists connected users", async () => {
    const res = await apiRequest(`/v1/multiplayer/${taskId}/users`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data?.data?.users)).toBe(true);
  });

  it("broadcasts cursor position", async () => {
    const res = await apiRequest(`/v1/multiplayer/${taskId}/cursor`, {
      method: "POST",
      body: JSON.stringify({ line: 10, column: 5, file: "src/index.ts" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.ok).toBe(true);
  });

  it("broadcasts selection range", async () => {
    const res = await apiRequest(`/v1/multiplayer/${taskId}/selection`, {
      method: "POST",
      body: JSON.stringify({
        startLine: 1,
        startColumn: 0,
        endLine: 5,
        endColumn: 10,
        file: "src/app.ts",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.ok).toBe(true);
  });

  it("validates missing line/column in cursor request", async () => {
    const res = await apiRequest(`/v1/multiplayer/${taskId}/cursor`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([400, 422]).toContain(res.status);
  });
});
