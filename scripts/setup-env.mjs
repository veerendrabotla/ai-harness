/**
 * One-time local setup: create .env from .env.example with fresh secrets.
 *
 *   node scripts/setup-env.mjs           # create .env if missing
 *   node scripts/setup-env.mjs --force   # overwrite an existing .env
 *
 * Used by both the Docker handoff path (`docker compose up -d`) and the
 * multi-terminal dev path described in docs/getting-started.md.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const examplePath = resolve(root, ".env.example");
const envPath = resolve(root, ".env");
const force = process.argv.includes("--force");

if (!existsSync(examplePath)) {
  console.error(".env.example not found — run this from the repository root.");
  process.exit(1);
}

if (existsSync(envPath) && !force) {
  console.log(".env already exists — leaving it untouched (use --force to regenerate).");
  process.exit(0);
}

let content = readFileSync(examplePath, "utf8");

const replacements = [
  ["JWT_ACCESS_SECRET=change-me-generate-a-long-random-secret", `JWT_ACCESS_SECRET=${randomBytes(48).toString("base64")}`],
  ["CSRF_SECRET=change-me-generate-a-long-random-secret", `CSRF_SECRET=${randomBytes(48).toString("base64")}`],
  ["ENCRYPTION_KEY=change-me-base64-encoded-32-bytes==", `ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`],
  ["BRIDGE_INTERNAL_TOKEN=change-me-generate-a-long-random-secret", `BRIDGE_INTERNAL_TOKEN=${randomBytes(48).toString("base64")}`],
];

for (const [placeholder, value] of replacements) {
  if (!content.includes(placeholder)) {
    console.error(`Placeholder missing in .env.example: ${placeholder.split("=")[0]}`);
    process.exit(1);
  }
  content = content.replace(placeholder, value);
}

writeFileSync(envPath, content, { encoding: "utf8" });
console.log(".env created with fresh JWT / CSRF / encryption / bridge secrets.");
console.log("Next: docker compose up -d   (all-in-Docker)");
console.log("  or: npm run infra:up && npm run db:generate && npm run db:migrate  (dev mode, see docs/getting-started.md)");
