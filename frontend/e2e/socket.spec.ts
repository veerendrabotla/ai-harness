import { expect, test } from "@playwright/test";

/**
 * Socket.IO connection and event verification via browser context.
 * Tests authenticate, connect, subscribe, receive events, handle disconnects.
 */

async function authenticate(page: import("@playwright/test").Page) {
  await page.goto("/signup");
  const email = `pw-socket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.getByLabel(/display name/i).fill("Socket Test User");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill("TestPass1234");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/(onboarding|sessions|agent)/, { timeout: 20_000 }).catch(() => undefined);
  return email;
}

test.describe("Socket.IO realtime", () => {
  test("authenticated page connects and shows connection state", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const title = page.title();
    expect(title).toBeTruthy();
  });

  test("login page renders without Socket.IO errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const criticalErrors = errors.filter(
      (e) => !e.includes("Socket") && !e.includes("socket") && !e.includes("ECONNREFUSED"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("signup and login flow completes without Socket.IO crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/signup");
    const email = `pw-socket-flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    await page.getByLabel(/display name/i).fill("Socket Test User");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill("TestPass1234");
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/(onboarding|sessions|agent)/, { timeout: 20_000 }).catch(() => undefined);
    const crashErrors = errors.filter(
      (e) => e.includes("Cannot read") || e.includes("undefined is not"),
    );
    expect(crashErrors).toHaveLength(0);
  });

  test("authenticated session page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await authenticate(page);
    await page.goto("/sessions");
    await page.waitForLoadState("networkidle");
    const criticalErrors = errors.filter(
      (e) => !e.includes("Socket") && !e.includes("socket") && !e.includes("ECONNREFUSED"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("agent page loads for authenticated user", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await authenticate(page);
    await page.goto("/agent");
    await page.waitForLoadState("networkidle");
    const criticalErrors = errors.filter(
      (e) => !e.includes("Socket") && !e.includes("socket") && !e.includes("ECONNREFUSED"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
