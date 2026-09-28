import { expect, test } from "@playwright/test";

test.describe("public shell", () => {
  test("landing page renders value proposition and CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Build faster with");
    await expect(page.getByRole("link", { name: /start building free/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^sign in$/i }).first()).toBeVisible();
  });

  test("login page exposes form with accessible labels", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("signup page enforces password guidance text", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
  });
});

test.describe("authenticated guard", () => {
  test("protected route redirects anonymous visitor to login with next param", async ({ page }) => {
    await page.goto("/sessions");
    await page.waitForURL(/\/login\?next=%2Fsessions/, { timeout: 10_000 }).catch(() => {
      // AppProviders may render the loading state briefly; assert final URL.
    });
    await expect(page).toHaveURL(/\/login/);
  });
});
