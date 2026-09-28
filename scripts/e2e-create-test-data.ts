import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const API = "http://localhost:4000";
const FIXTURE = String.raw`C:\Users\Sridhar\Documents\Default Project\fixtures\hello-app`;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status} ${path}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  // 1. Login with existing user
  console.log("1. Login...");
  const login = await api("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "e2e-1787810337434-orndvu@test.com", password: "TestPass1234" }),
  });
  const token = login.data?.accessToken ?? login.accessToken;
  const userId = login.data?.userId ?? login.userId;
  console.log(`   User: ${userId}`);
  const H = { Authorization: `Bearer ${token}` };

  const wsId = "560a9804-bdc4-4700-82c8-2907f5ecd2c7";
  const projId = "aaf79522-bdba-4958-9d81-8eb4d98de00d";
  const bridgeId = "b3f20b89-6554-436a-bb97-284d0a39b542";
  console.log(`   Workspace: ${wsId}`);
  console.log(`   Project: ${projId}`);
  console.log(`   Bridge: ${bridgeId}`);

  // 2. Create TEST provider
  console.log("2. Create TEST provider...");
  const prov = await api("/v1/providers", {
    method: "POST", headers: H,
    body: JSON.stringify({ providerType: "TEST", displayName: "E2E Test Provider", credential: "plan-then-execute" }),
  });
  const provId = prov.data?.id ?? prov.id;
  console.log(`   Provider: ${provId}`);

  // 3. Link provider to workspace
  console.log("3. Link provider to workspace...");
  try {
    await api(`/v1/workspaces/${wsId}/providers`, {
      method: "POST", headers: H, body: JSON.stringify({ providerConnectionId: provId }),
    });
    console.log("   Linked");
  } catch (e) { console.log(`   Note: ${(e as Error).message}`); }

  // 4. Create model routes
  console.log("4. Create model routes...");
  try {
    await api(`/v1/workspaces/${wsId}/model-routes`, {
      method: "PUT", headers: H,
      body: JSON.stringify({ routes: [
        { stage: "PLANNING", providerConnectionId: provId, modelIdentifier: "test-model", priority: 1 },
        { stage: "IMPLEMENTATION", providerConnectionId: provId, modelIdentifier: "test-model", priority: 1 },
        { stage: "REVIEW", providerConnectionId: provId, modelIdentifier: "test-model", priority: 1 },
      ] }),
    });
    console.log("   Routes created");
  } catch (e) { console.log(`   Note: ${(e as Error).message}`); }

  // Output context for Playwright
  const context = { userId, accessToken: token, workspaceId: wsId, projectId: projId, bridgeId, providerId: provId, email: "e2e-1787810337434-orndvu@test.com", password: "TestPass1234", fixtureDir: FIXTURE };
  const outDir = join(process.cwd(), "test-results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "e2e-context.json"), JSON.stringify(context, null, 2), "utf8");
  console.log("\n=== E2E Context ===");
  console.log(JSON.stringify(context, null, 2));
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
