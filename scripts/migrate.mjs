/**
 * One-shot migration runner for docker-compose `migrate` service.
 * Runs `prisma migrate deploy` against DATABASE_URL and exits.
 * Used as an init container so api/worker/gateway never start on a stale schema.
 */
import { execSync } from "node:child_process";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("[migrate] DATABASE_URL is not set — skipping migrations");
  process.exit(0);
}

console.log("[migrate] Running prisma migrate deploy...");
try {
  execSync("npx prisma migrate deploy --schema=backend/prisma/schema.prisma", {
    stdio: "inherit",
    env: process.env,
  });
  console.log("[migrate] Migrations applied successfully.");
} catch (err) {
  console.error("[migrate] Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
