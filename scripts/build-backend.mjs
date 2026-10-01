/**
 * Production backend bundler — replaces tsx in deployed images.
 * Bundles each app entry into a self-contained ESM file under dist/<app>/,
 * keeping native/heavy modules external (loaded from node_modules at runtime).
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

const EXTERNAL = [
  "@prisma/client",
  "zod",
  "argon2",
  "pino",
  "pino-pretty",
  "ws",
  "ioredis",
  "bullmq",
  "@sentry/node",
  "@anthropic-ai/sdk",
  "openai",
  "@google/genai",
  "ollama",
  "resend",
  // CJS plugins that resolve their static assets via __dirname — inlining
  // them into the ESM bundle breaks that (ReferenceError at boot).
  "@fastify/swagger-ui",
];

const targets = [
  { entry: "backend/apps/api/src/server.ts", out: "dist/api/index.js" },
  { entry: "backend/apps/worker/src/worker.ts", out: "dist/worker/index.js" },
  { entry: "backend/apps/bridge-gateway/src/server.ts", out: "dist/gateway/index.js" },
];

mkdirSync("dist", { recursive: true });

const only = process.argv[2];
for (const t of only ? targets.filter((x) => x.out.includes(only)) : targets) {
  await build({
    entryPoints: [t.entry],
    outfile: t.out,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: EXTERNAL,
    sourcemap: false,
    logLevel: "info",
    banner: {
      // CJS deps (prisma engines, argon2) call require() at runtime inside ESM output.
      // The injected bindings use __ prefixes: source files legitimately import
      // createRequire too (auth-service.ts) and a bare banner name would collide
      // as a duplicate top-level identifier in the ESM output (boot SyntaxError).
      js: 'import { createRequire as __banner_createRequire } from "module"; const require = __banner_createRequire(import.meta.url);',
    },
  });
}

console.log("backend bundles written to ./dist");
