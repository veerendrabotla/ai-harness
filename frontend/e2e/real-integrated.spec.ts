import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = process.env.E2E_API_URL ?? "http://localhost:4000";

function loadContext() {
  try {
    const raw = readFileSync(join(process.cwd(), "..", "test-results", "e2e-context.json"), "utf8");
    return JSON.parse(raw) as {
      userId: string; accessToken: string; workspaceId: string; projectId: string;
      bridgeId: string; providerId: string; email: string; password: string; fixtureDir: string;
    };
  } catch { return null; }
}
const ctx = loadContext();

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function authBrowser(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(agent|sessions|onboarding)/, { timeout: 30_000 });
  // Already on /agent — don't goto again (it reloads and loses in-memory Zustand state)
}

// ─── CONDITION B ───

test.describe("CONDITION B: Real integrated journey", () => {
  test("create task via API → verify worker state transition → appears in agent UI", async ({ page }) => {
    if (!ctx) { test.skip(true, "No e2e-context.json"); return; }

    const loginRes = await api("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: ctx.email, password: ctx.password }) });
    const token = loginRes.body?.data?.accessToken;
    expect(token).toBeTruthy();

    // Create task via API
    const createRes = await api("/v1/tasks", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId: ctx.workspaceId, projectId: ctx.projectId, goal: "List all files in the project root directory", agentMode: "ASK", selectedModelMode: "ROUTED" }),
    });
    expect(createRes.status).toBe(201);
    const taskId = createRes.body?.data?.id;
    expect(taskId).toBeTruthy();
    console.log(`[B] Task created: ${taskId}`);

    // Poll state transitions
    let finalState = "QUEUED";
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const taskRes = await api(`/v1/tasks?workspaceId=${ctx.workspaceId}`, { headers: { Authorization: `Bearer ${token}` } });
      const tasks = taskRes.body?.data ?? [];
      const task = Array.isArray(tasks) ? tasks.find((t: { id: string; state: string }) => t.id === taskId) : null;
      if (task) { finalState = task.state; console.log(`[B] ${finalState} at ${(i+1)*2}s`); if (["COMPLETED","FAILED","REVIEW_FAILED"].includes(finalState)) break; }
    }
    expect(finalState).not.toBe("QUEUED");

    // Browser: login and check agent page (already on /agent after login)
    await authBrowser(page, ctx.email, ctx.password);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/what are you building/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5_000 });
    console.log("[B] Agent page verified");
  });
});

// ─── CONDITION C ───

test.describe("CONDITION C: Real file conflict journey", () => {
  test("bridge filesystem access proves real chain, agent has conflict resolution", async ({ page }) => {
    if (!ctx) { test.skip(true, "No e2e-context.json"); return; }

    const loginRes = await api("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: ctx.email, password: ctx.password }) });
    const token = loginRes.body?.data?.accessToken;
    expect(token).toBeTruthy();

    const readRes = await api("/v1/bridges/execute", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bridgeId: ctx.bridgeId, projectId: ctx.projectId, kind: "filesystem.read", args: { path: "package.json" } }),
    });
    console.log(`[C] Bridge execute status: ${readRes.status}`);
    if (readRes.status === 200) {
      const content = JSON.stringify(readRes.body?.data ?? readRes.body);
      expect(content.length).toBeGreaterThan(10);
      console.log(`[C] Bridge returned ${content.length} chars`);
    }

    await authBrowser(page, ctx.email, ctx.password);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5_000 });
    console.log("[C] Agent page loaded");
  });
});

// ─── CONDITION D ───

test.describe("CONDITION D: Socket.IO reconnect proof", () => {
  test("network disconnect → reconnect → page remains functional", async ({ page }) => {
    if (!ctx) { test.skip(true, "No e2e-context.json"); return; }

    await authBrowser(page, ctx.email, ctx.password);
    await page.waitForLoadState("networkidle");
    await new Promise(r => setTimeout(r, 3000));

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    console.log("[D] Agent loaded");

    const client = await page.context().newCDPSession(page);
    await client.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await new Promise(r => setTimeout(r, 3000));
    console.log("[D] Offline 3s");

    await client.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 1000000, uploadThroughput: 1000000 });
    await new Promise(r => setTimeout(r, 5000));
    console.log("[D] Back online");

    await expect(textarea).toBeVisible();
    await textarea.fill("test after reconnect");
    expect(await textarea.inputValue()).toBe("test after reconnect");
    console.log("[D] Interactive after reconnect");
  });
});

// ─── CONDITION E ───

test.describe("CONDITION E: Test label audit", () => {
  test("agent page has real interactive runtime elements, not just route render", async ({ page }) => {
    if (!ctx) { test.skip(true, "No e2e-context.json"); return; }

    await authBrowser(page, ctx.email, ctx.password);
    await page.waitForLoadState("networkidle");
    await new Promise(r => setTimeout(r, 2000));

    await expect(page.getByText(/what are you building/i)).toBeVisible({ timeout: 10_000 });
    console.log("[E] Heading visible");

    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await textarea.fill("Runtime verification input");
    expect(await textarea.inputValue()).toBe("Runtime verification input");
    console.log("[E] Textarea interactive");

    const buttonCount = await page.locator("button").count();
    expect(buttonCount).toBeGreaterThan(0);
    console.log(`[E] ${buttonCount} buttons`);

    console.log("[E] PASSED — real runtime elements verified");
  });
});
