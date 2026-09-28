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
      email: `sso-test-${Date.now()}@example.com`,
      password: "Testpass123!",
      displayName: "SSO Test User",
    }),
  });

  if (registerRes.ok) {
    const data = await registerRes.json();
    authToken = data?.data?.accessToken ?? "";
  }

  if (authToken) {
    // SSO routes enforce workspace membership — create a real workspace.
    const wsRes = await apiRequest("/v1/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "SSO Test Workspace" }),
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

d("SSO Integration Tests", () => {
  let configId = "";

  it("creates SSO configuration", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso`, {
      method: "POST",
      body: JSON.stringify({
        provider: "okta",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        issuerUrl: "https://test.okta.com",
        domain: "test.com",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    configId = data?.data?.id ?? "";
    expect(data?.data?.provider).toBe("okta");
    expect(data?.data?.enabled).toBe(true);
  });

  it("lists SSO configurations", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data?.data)).toBe(true);
  });

  it("gets SSO configuration by ID", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso/${configId}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.id).toBe(configId);
    expect(data?.data?.provider).toBe("okta");
  });

  // Login must run while the config is still enabled — the update test below
  // disables it, and the login endpoint (correctly) 404s for disabled configs.
  it("initiates SSO login (returns redirect URL)", async () => {
    const res = await apiRequest(`/v1/sso/${workspaceId}/okta/login`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.redirectUrl).toBeDefined();
    expect(typeof data?.data?.state).toBe("string");
  });

  it("updates SSO configuration", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso/${configId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: false, domain: "updated.com" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.enabled).toBe(false);
    expect(data?.data?.domain).toBe("updated.com");
  });

  it("handles SSO callback with mock OAuth code", async () => {
    const res = await apiRequest(`/v1/sso/${workspaceId}/okta/callback`, {
      method: "POST",
      body: JSON.stringify({ code: "mock-oauth-code", state: "mock-state" }),
    });
    expect([200, 400, 404]).toContain(res.status);
  });

  it("handles SSO callback with mock SAML response", async () => {
    const samlXml = `<samlp:Response><saml:Assertion><saml:NameID>user@example.com</saml:NameID><Attribute Name="email"><AttributeValue>user@example.com</AttributeValue></Attribute><Attribute Name="name"><AttributeValue>Test User</AttributeValue></Attribute></saml:Assertion></samlp:Response>`;
    const samlBase64 = Buffer.from(samlXml).toString("base64");

    const res = await apiRequest(`/v1/sso/${workspaceId}/saml/callback`, {
      method: "POST",
      body: JSON.stringify({ samlResponse: samlBase64 }),
    });
    expect([200, 400, 404]).toContain(res.status);
  });

  it("tests SSO configuration (returns parsed info)", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso/${configId}/test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.valid).toBeDefined();
    expect(data?.data?.provider).toBe("okta");
  });

  it("returns 404 for non-existent SSO config", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it("validates missing provider in create request", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([400, 422]).toContain(res.status);
  });

  it("deletes SSO configuration", async () => {
    const res = await apiRequest(`/v1/workspaces/${workspaceId}/sso/${configId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.data?.success).toBe(true);
  });
});
