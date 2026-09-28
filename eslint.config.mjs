// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "frontend/.next/**",
      "backend/node_modules/**",
      "local_bridge/**",
      "**/*.mjs",
      "scripts/**",
    ],
  },
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ["backend/**/*.ts", "scripts/**/*.ts", "*.ts", "*.mts"],
  })),
  {
    files: ["backend/**/*.ts", "scripts/**/*.ts", "*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    // The CLI's stdout IS its user interface.
    files: ["backend/packages/cli/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Tests report diagnostics (timings, load results) to stdout.
    files: ["backend/**/*.test.ts", "backend/apps/api/tests/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
