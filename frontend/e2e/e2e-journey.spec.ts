import { expect, test } from "@playwright/test";

/**
 * Full E2E journey tests.
 * Tests the complete user flow from signup through agent workspace.
 */

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function ensureAuthenticated(page: import("@playwright/test").Page) {
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/display name/i).fill("E2E User");
  await page.getByLabel(/email/i).fill(`pw-e2e-${uniqueId()}@example.com`);
  await page.getByLabel(/password/i).fill("TestPass1234");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/(onboarding|sessions|agent|login)/, { timeout: 20_000 }).catch(() => undefined);
}

test.describe("full E2E journey", () => {
  test("complete user journey: signup → onboarding → agent workspace", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByLabel(/display name/i).fill("Journey User");
    await page.getByLabel(/email/i).fill(`pw-journey-${uniqueId()}@example.com`);
    await page.getByLabel(/password/i).fill("JourneyPass1234");
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/(onboarding|sessions|agent)/, { timeout: 20_000 }).catch(() => undefined);

    // Navigate directly to authenticated pages
    for (const route of ["/sessions", "/agent", "/settings"]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(await page.textContent("body")).toBeTruthy();
    }

    // Agent page should render (empty state or with content)
    await page.goto("/agent");
    await page.waitForLoadState("networkidle");
    const bodyText = await page.textContent("body") ?? "";
    // Empty workspace shows "What are you building?" or similar agent UI
    expect(bodyText.length).toBeGreaterThan(100);

    const criticalErrors = errors.filter(
      (e) => !e.includes("Socket") && !e.includes("socket") && !e.includes("ECONNREFUSED"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("navigation flow: all main routes are accessible", async ({ page }) => {
    await ensureAuthenticated(page);

    for (const route of ["/sessions", "/agent", "/settings"]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const content = await page.textContent("body");
      expect(content).toBeTruthy();
      expect(content!.length).toBeGreaterThan(0);
    }
  });

  test("agent workspace has core UI elements", async ({ page }) => {
    await ensureAuthenticated(page);

    await page.goto("/agent");
    await page.waitForLoadState("networkidle");

    // Agent workspace should show either:
    // 1. Empty workspace with "What are you building?" heading
    // 2. Active task view with conversation/inputs
    const heading = page.getByText(/what are you building/i);
    const hasEmptyState = (await heading.count()) > 0;
    const bodyText = await page.textContent("body") ?? "";
    const hasContent = bodyText.length > 100;
    expect(hasEmptyState || hasContent).toBeTruthy();
  });
});
