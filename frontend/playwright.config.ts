import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for the PWA shell + full agent workspace.
 * Runs against the production build served via `next start` (webServer below).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    colorScheme: "dark",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "shell", testMatch: /shell\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "auth", testMatch: /auth\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "responsive-mobile-375", testMatch: /responsive\.spec\.ts/, use: { ...devices["Pixel 5"] } },
    { name: "responsive-tablet-768", testMatch: /responsive\.spec\.ts/, use: { viewport: { width: 768, height: 1024 } } },
    { name: "responsive-desktop-1024", testMatch: /responsive\.spec\.ts/, use: { viewport: { width: 1024, height: 768 } } },
    { name: "responsive-desktop-1440", testMatch: /responsive\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
    { name: "e2e-journey", testMatch: /e2e-journey\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "socket-io", testMatch: /socket\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "failure-scenarios", testMatch: /failure\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "real-integrated", testMatch: /real-integrated\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
