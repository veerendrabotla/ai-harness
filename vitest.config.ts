import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "backend/packages/*/src/**/*.test.ts",
      "backend/apps/*/src/**/*.test.ts",
      "backend/apps/*/tests/**/*.test.ts",
      "frontend/src/**/*.test.ts",
      "local_bridge/src/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
});
