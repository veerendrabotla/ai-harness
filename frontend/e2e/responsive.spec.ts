import { expect, test } from "@playwright/test";

/**
 * Responsive viewport verification.
 * Each project runs this spec at a different viewport size.
 */

test.describe("responsive layout", () => {
  test("page loads and has no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    // Wait for page to settle
    await page.waitForLoadState("networkidle");

    // Check no horizontal scrollbar (body width <= viewport width)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 1440;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 2); // +2 for subpixel rounding
  });

  test("login form is accessible at all viewports", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByLabel(/password/i);
    const submitButton = page.getByRole("button", { name: /sign in/i });

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitButton).toBeVisible();

    // Verify all are reachable (not clipped)
    const submitBox = await submitButton.boundingBox();
    if (submitBox) {
      expect(submitBox.x).toBeGreaterThanOrEqual(0);
      expect(submitBox.y).toBeGreaterThanOrEqual(0);
    }
  });

  test("landing page CTAs are visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /create account/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("no critical controls clipped offscreen", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // All form elements should be within viewport
    const elements = [
      page.getByLabel(/email/i),
      page.getByLabel(/password/i),
      page.getByRole("button", { name: /sign in/i }),
    ];

    const viewport = page.viewportSize();
    if (!viewport) return;

    for (const el of elements) {
      const box = await el.boundingBox();
      if (box) {
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2);
        expect(box.x).toBeGreaterThanOrEqual(-2);
      }
    }
  });
});
