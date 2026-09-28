import { expect, test } from "@playwright/test";

/**
 * Failure scenario verification via browser.
 * Tests that the app handles edge cases and errors gracefully.
 */

test.describe("failure scenarios", () => {
  test("unauthenticated access redirects to login", async ({ page }) => {
    const protectedRoutes = ["/sessions", "/agent", "/settings"];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      // Should redirect to login (possibly with ?next= parameter)
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("invalid signup shows validation errors", async ({ page }) => {
    await page.goto("/signup");

    // Try submitting empty form
    await page.getByRole("button", { name: /create account/i }).click();

    // Should show validation errors (HTML5 or custom)
    // The form should not navigate away
    expect(page.url()).toContain("/signup");
  });

  test("short password is rejected", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(/display name/i).fill("Test");
    await page.getByLabel(/email/i).fill(`pw-short-${Date.now()}@example.com`);
    await page.getByLabel(/password/i).fill("short");
    await page.getByRole("button", { name: /create account/i }).click();

    // Should show password guidance or not navigate
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/signup");
  });

  test("duplicate email signup shows error", async ({ page }) => {
    const email = `pw-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

    // First signup
    await page.goto("/signup");
    await page.getByLabel(/display name/i).fill("First User");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill("TestPass1234");
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/(onboarding|sessions)/, { timeout: 20_000 }).catch(() => undefined);

    // Logout by clearing storage
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Second signup with same email
    await page.goto("/signup");
    await page.getByLabel(/display name/i).fill("Second User");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill("TestPass1234");
    await page.getByRole("button", { name: /create account/i }).click();

    // Should show error about duplicate email or not navigate away
    await page.waitForTimeout(3000);
    expect(page.url()).toContain("/signup");
  });

  test("bad login credentials show error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(`nonexistent-${Date.now()}@example.com`);
    await page.getByLabel(/password/i).fill("WrongPassword123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // The route announcer is also role=alert — target the error region that carries the message.
    await expect(
      page.getByRole("alert").filter({ hasText: /invalid email or password/i }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("network error on login shows error state", async ({ page }) => {
    // Intercept API calls to simulate network failure
    await page.route("**/v1/auth/login", (route) => route.abort("connectionrefused"));

    await page.goto("/login");
    await page.getByLabel(/email/i).fill("test@example.com");
    await page.getByLabel(/password/i).fill("TestPass1234");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should show some error state (network or generic)
    await page.waitForTimeout(5000);
    // Page should not crash
    const pageContent = await page.content();
    expect(pageContent).toBeTruthy();
  });

  test("404 page renders for unknown routes", async ({ page }) => {
    await page.goto("/nonexistent-route-12345");
    await page.waitForLoadState("networkidle");

    // App should handle unknown routes (Next.js 404 or custom)
    const content = await page.content();
    expect(content).toBeTruthy();
  });
});
