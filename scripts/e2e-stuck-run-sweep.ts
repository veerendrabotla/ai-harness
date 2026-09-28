/**
 * Stuck-run recovery E2E (PHASE 13 #7).
 *
 * Seeds a task + active run with a backdated startedAt (simulating a worker
 * that died mid-flight), runs the real sweepStuckRuns against the live
 * database, and asserts:
 *   - the stale run + task flip to INTERRUPTED (pauseRequested cleared)
 *   - a RUN_INTERRUPTED event with payload.reason=WORKER_LOST is persisted
 *   - a fresh run on a separate task is untouched
 * Cleans up every row it created.
 *
 * Usage: npm run e2e:sweep   (requires the Docker stack / DATABASE_URL)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { EventPublisher } from "../backend/packages/agent-runtime/src/event-publisher.js";
import { sweepStuckRuns } from "../backend/apps/worker/src/stuck-run-sweep.js";

function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // no .env — rely on the ambient environment
  }
}

function log(msg: string): void {
  console.log(`[e2e:sweep] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[e2e:sweep] FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set (run from the repo root with .env present)");

  const db = new PrismaClient();
  const events = new EventPublisher(db);
  const logger = {
    warn: (obj: Record<string, unknown>, msg: string) => log(`warn: ${msg} ${JSON.stringify(obj)}`),
    error: () => undefined,
    info: () => undefined,
  };

  const stamp = Date.now();
  let created: { userId: string; workspaceId: string; projectId: string; staleTaskId: string; freshTaskId: string } | null = null;

  try {
    const user = await db.user.create({
      data: {
        email: `sweep-e2e-${stamp}@example.com`,
        passwordHash: "not-a-real-hash",
        displayName: "Sweep E2E",
      },
      select: { id: true },
    });
    const workspace = await db.workspace.create({
      data: { ownerId: user.id, name: `Sweep E2E ${stamp}` },
      select: { id: true },
    });
    const project = await db.project.create({
      data: { workspaceId: workspace.id, name: `sweep-e2e-${stamp}`, rootReference: "/" },
      select: { id: true },
    });
    const staleTask = await db.task.create({
      data: { workspaceId: workspace.id, projectId: project.id, createdBy: user.id, goal: "stale run E2E (stuck)", state: "EXECUTING" },
      select: { id: true },
    });
    const freshTask = await db.task.create({
      data: { workspaceId: workspace.id, projectId: project.id, createdBy: user.id, goal: "fresh run E2E (must stay active)", state: "EXECUTING" },
      select: { id: true },
    });
    const staleRun = await db.taskRun.create({
      data: {
        taskId: staleTask.id,
        runNumber: 1,
        state: "EXECUTING",
        startedAt: new Date(Date.now() - 16 * 60_000), // past the 15-min grace
      },
      select: { id: true },
    });
    const freshRun = await db.taskRun.create({
      data: { taskId: freshTask.id, runNumber: 1, state: "EXECUTING", startedAt: new Date() },
      select: { id: true },
    });
    created = { userId: user.id, workspaceId: workspace.id, projectId: project.id, staleTaskId: staleTask.id, freshTaskId: freshTask.id };
    log("seeded stale + fresh task/run pairs");

    const interrupted = await sweepStuckRuns({ db, events, logger });
    log(`sweep interrupted ${interrupted} run(s)`);

    const staleRunAfter = await db.taskRun.findUniqueOrThrow({ where: { id: staleRun.id } });
    const staleTaskAfter = await db.task.findUniqueOrThrow({ where: { id: staleTask.id } });
    const freshRunAfter = await db.taskRun.findUniqueOrThrow({ where: { id: freshRun.id } });
    const freshTaskAfter = await db.task.findUniqueOrThrow({ where: { id: freshTask.id } });
    const event = await db.taskEvent.findFirst({
      where: { taskId: staleTask.id, eventType: "RUN_INTERRUPTED" },
      orderBy: { sequenceNumber: "desc" },
    });

    if (staleRunAfter.state !== "INTERRUPTED") fail(`stale run state ${staleRunAfter.state}, expected INTERRUPTED`);
    if (staleTaskAfter.state !== "INTERRUPTED") fail(`stale task state ${staleTaskAfter.state}, expected INTERRUPTED`);
    if (staleTaskAfter.pauseRequested) fail("stale task pauseRequested should be cleared");
    if (!event) fail("RUN_INTERRUPTED event was not persisted");
    const payload = (event.payload ?? {}) as { reason?: string };
    if (payload.reason !== "WORKER_LOST") fail(`event reason ${payload.reason ?? "missing"}, expected WORKER_LOST`);
    if (freshRunAfter.state !== "EXECUTING") fail(`fresh run was touched: ${freshRunAfter.state}`);
    if (freshTaskAfter.state !== "EXECUTING") fail(`fresh task was touched: ${freshTaskAfter.state}`);

    log("ALL STUCK-RUN SWEEP CHECKS PASSED");
  } finally {
    if (created) {
      await db.taskEvent.deleteMany({ where: { taskId: { in: [created.staleTaskId, created.freshTaskId] } } });
      await db.taskRun.deleteMany({ where: { taskId: { in: [created.staleTaskId, created.freshTaskId] } } });
      await db.task.deleteMany({ where: { id: { in: [created.staleTaskId, created.freshTaskId] } } });
      await db.project.delete({ where: { id: created.projectId } }).catch(() => undefined);
      await db.workspace.delete({ where: { id: created.workspaceId } }).catch(() => undefined);
      await db.user.delete({ where: { id: created.userId } }).catch(() => undefined);
      log("cleanup complete");
    }
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("[e2e:sweep] FAILED:", err);
  process.exit(1);
});
