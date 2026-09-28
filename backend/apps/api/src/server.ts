import { ensureEnvLoaded } from "@ai-harness/shared";
import { prisma as db } from "@ai-harness/database";
import { buildApp } from "./app.js";
import { startEmailWorker, closeEmailQueue } from "./lib/email-queue.js";

async function main() {
  ensureEnvLoaded();
  // Validate configuration before anything binds a port.
  const { loadEnv } = await import("@ai-harness/shared");
  const env = loadEnv();

  if (process.env["SENTRY_DSN"]) {
    try {
      const Sentry = await import("@sentry/node");
      Sentry.init({ dsn: String(process.env["SENTRY_DSN"]), environment: env.NODE_ENV });
    } catch (err) { process.stderr.write(`[Sentry] Failed to import optional dependency: ${err instanceof Error ? err.message : String(err)}\n`); }
  }
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err, "failed to start API server");
    process.exit(1);
  }

  // Consume the BullMQ email queue (invitations + notification emails).
  const emailWorker = startEmailWorker(db);
  emailWorker.on("error", (err) => app.log.error({ err }, "email worker error"));

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await emailWorker.close().catch(() => undefined);
    await closeEmailQueue().catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // Fail loudly and clearly on startup problems (bad env, unreachable deps).
   
  process.stderr.write(`FATAL: AI Harness API failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
