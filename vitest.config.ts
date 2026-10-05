import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the frontend tsconfig "@/*" path alias so frontend source files
    // (e.g. use-task-socket.ts) resolve when imported from tests.
    alias: {
      "@": fileURLToPath(new URL("./frontend/src", import.meta.url)),
    },
  },
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
