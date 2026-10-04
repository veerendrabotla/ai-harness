/**
 * Usage endpoints regression test.
 *
 * Guards the response-envelope contract: routes send replies through ok(),
 * which wraps payloads as { data, requestId }. Declaring an unwrapped payload
 * schema made fastify's serializer reject array roots (500) and strip object
 * payloads (silent {}), breaking the Token Usage page for every user.
 */
import { describe, it, expect, beforeAll } from "vitest";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

let serverAvailable = false;
try {
  const health = await fetch(`${API_URL}/v1/health`);
  serverAvailable = health.ok;
} catch {
  serverAvailable = false;
}

const d = describe.skipIf(!serverAvailable);

async function call(
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

d("Usage API response envelope", () => {
  let token: string;

  beforeAll(async () => {
    const res = await fetch(`${API_URL}/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `usage-envelope-${Date.now()}@test.com`,
        password: "TestPassword123!",
        displayName: "Usage Envelope Test",
      }),
    });
    const json = (await res.json()) as { data?: { accessToken?: string } };
    token = json.data?.accessToken ?? "";
    expect(token).toBeTruthy();
  });

  it("GET /v1/usage returns an envelope with token counters", async () => {
    const { status, body } = await call("/v1/usage", token);
    expect(status).toBe(200);
    const data = body.data as Record<string, unknown> | undefined;
    expect(data).toBeDefined();
    expect(data!.inputTokens).toBe(0);
    expect(data!.totalTokens).toBe(0);
    expect(data!.totalCalls).toBe(0);
    expect(body.requestId).toBeDefined();
  });

  it("GET /v1/usage/by-model returns an envelope with an array", async () => {
    const { status, body } = await call("/v1/usage/by-model", token);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /v1/usage/by-task returns an envelope with an array", async () => {
    const { status, body } = await call("/v1/usage/by-task?limit=10", token);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /v1/usage/trend returns an envelope with an array", async () => {
    const { status, body } = await call("/v1/usage/trend?days=30", token);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
