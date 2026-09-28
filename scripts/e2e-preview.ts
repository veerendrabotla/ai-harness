#!/usr/bin/env tsx
/**
 * Preview E2E — starts fixture project, starts preview via API, verifies content.
 * Run: npx tsx scripts/e2e-preview.ts
 */

const API = process.env.API_URL ?? "http://localhost:4000";
const FIXTURE_DIR = process.env.FIXTURE_DIR ?? "C:\\Users\\Sridhar\\Documents\\Default Project\\fixtures\\hello-app";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log("=== Preview E2E Test ===\n");

  // 1. Health check
  console.log("1. Checking API health...");
  const health = await api("/health");
  console.log("   API health:", health);

  // 2. Create user + workspace + project (or reuse existing)
  console.log("\n2. Creating test user...");
  let user: { id: string; accessToken: string };
  try {
    user = await api("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Preview E2E",
        email: `preview-e2e-${Date.now()}@test.com`,
        password: "TestPass1234",
      }),
    });
  } catch {
    // User may already exist, try login
    user = await api("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: `preview-e2e-${Date.now()}@test.com`,
        password: "TestPass1234",
      }),
    });
  }
  console.log("   User created:", user.id);

  const authHeaders = { Authorization: `Bearer ${user.accessToken}` };

  // 3. Create workspace
  console.log("\n3. Creating workspace...");
  const workspace = await api("/v1/workspaces", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "Preview E2E Workspace" }),
  });
  console.log("   Workspace:", workspace.id);

  // 4. Create project
  console.log("\n4. Creating project...");
  const project = await api(`/v1/workspaces/${workspace.id}/projects`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "hello-app", rootReference: FIXTURE_DIR }),
  });
  console.log("   Project:", project.id);

  // 5. List project files
  console.log("\n5. Listing project files...");
  const files = await api(`/v1/projects/${project.id}/files`, {
    headers: authHeaders,
  });
  console.log("   Files:", JSON.stringify(files, null, 2));

  // 6. Read a file
  console.log("\n6. Reading server.js...");
  const fileContent = await api(`/v1/projects/${project.id}/files/read`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ path: "server.js" }),
  });
  console.log("   First 100 chars:", fileContent.content?.substring(0, 100));

  // 7. Start preview
  console.log("\n7. Starting preview...");
  const preview = await api(`/v1/projects/${project.id}/preview/start`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ configuredPort: 3001 }),
  });
  console.log("   Preview:", JSON.stringify(preview, null, 2));

  // 8. Wait for preview to be ready
  console.log("\n8. Waiting for preview to start...");
  let previewReady = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await api(`/v1/projects/${project.id}/preview/status`, {
      headers: authHeaders,
    });
    console.log(`   Attempt ${i + 1}: status=${status.status}, url=${status.url}`);
    if (status.status === "running" && status.url) {
      previewReady = true;

      // 9. Verify preview URL responds
      console.log("\n9. Verifying preview URL responds...");
      try {
        const previewRes = await fetch(status.url);
        console.log(`   Status: ${previewRes.status}`);
        const html = await previewRes.text();
        console.log(`   Contains "Hello Fixture App": ${html.includes("Hello Fixture App")}`);
        console.log(`   Contains "status-badge": ${html.includes("status-badge")}`);
      } catch (err) {
        console.log(`   Preview fetch error: ${(err as Error).message}`);
      }
      break;
    }
  }

  if (!previewReady) {
    console.log("\n   WARNING: Preview did not become ready within timeout");
  }

  // 10. Get preview logs
  console.log("\n10. Getting preview logs...");
  const logs = await api(`/v1/projects/${project.id}/preview/logs`, {
    headers: authHeaders,
  });
  console.log("   Logs:", JSON.stringify(logs, null, 2));

  // 11. Stop preview
  console.log("\n11. Stopping preview...");
  await api(`/v1/projects/${project.id}/preview/stop`, {
    method: "POST",
    headers: authHeaders,
  });
  console.log("   Preview stopped");

  // 12. Verify stopped
  await new Promise((r) => setTimeout(r, 1000));
  const finalStatus = await api(`/v1/projects/${project.id}/preview/status`, {
    headers: authHeaders,
  });
  console.log("   Final status:", finalStatus.status);

  // 13. Restart preview
  console.log("\n12. Restarting preview...");
  const restart = await api(`/v1/projects/${project.id}/preview/start`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ configuredPort: 3001 }),
  });
  console.log("   Restart:", JSON.stringify(restart, null, 2));

  // 14. Wait for restart
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await api(`/v1/projects/${project.id}/preview/status`, {
      headers: authHeaders,
    });
    if (status.status === "running") {
      console.log(`   Restarted successfully on attempt ${i + 1}`);
      break;
    }
  }

  // 15. Stop final
  await api(`/v1/projects/${project.id}/preview/stop`, {
    method: "POST",
    headers: authHeaders,
  });

  console.log("\n=== Preview E2E Complete ===");
}

main().catch((err) => {
  console.error("E2E failed:", err);
  process.exit(1);
});
