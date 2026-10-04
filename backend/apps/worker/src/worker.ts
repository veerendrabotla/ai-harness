import { Redis } from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { prisma as db } from "@ai-harness/database";
import {
  BridgeGatewayClient,
  createControlRegistry,
  createLogger,
  ensureEnvLoaded,
  getEnv,
  redactValue,
  subscribeTaskControl,
  TASK_EVENTS_CHANNEL,
  APPROVAL_EVENTS_CHANNEL,
  DEPLOYMENT_STATUS_CHANNEL,
  type TaskJob,
} from "@ai-harness/shared";
import { buildAgentRuntime } from "@ai-harness/agent-runtime";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import { MCPRegistry } from "@ai-harness/mcp-platform";
import { buildCompositeResolver } from "./sandbox.js";
import { sweepStuckRuns } from "./stuck-run-sweep.js";
import { sweepDueSchedules } from "./schedule-sweep.js";
import { expireStaleApprovals } from "./approval-expiry.js";
import { cleanStaleJobs, QUEUE_RETENTION } from "./queue-hygiene.js";

// Notification service import (duplicated to avoid cross-package dependency)
async function sendTaskNotification(
  taskId: string,
  workspaceId: string,
  status: "completed" | "failed",
  error?: string,
): Promise<void> {
  try {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { webhookUrls: true, name: true },
    });
    if (!workspace) return;

    const payload = {
      event: status === "completed" ? "task_completed" : "task_failed",
      timestamp: new Date().toISOString(),
      data: { taskId, workspaceId, error },
    };

    for (const url of workspace.webhookUrls) {
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        process.stderr.write(`[Worker] webhook delivery failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`[Worker] notification dispatch failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function main() {
  ensureEnvLoaded();
  const env = getEnv();
  if (process.env["SENTRY_DSN"]) {
    try {
      const Sentry = await import("@sentry/node");
      Sentry.init({ dsn: String(process.env["SENTRY_DSN"]), environment: env.NODE_ENV });
    } catch (err) { process.stderr.write(`[Worker] Sentry init failed: ${err instanceof Error ? err.message : String(err)}\n`); }
  }
  const logger = createLogger({ name: "ai-harness-worker", level: env.LOG_LEVEL });

  const publisher = new Redis(env.REDIS_URL);
  publisher.on("error", (err) => logger.error({ err }, "publisher redis error"));

  const control = createControlRegistry();
  const controlBusRedis = new Redis(env.REDIS_URL);
  controlBusRedis.on("error", (err) => logger.error({ err }, "control-bus redis error"));
  subscribeTaskControl(controlBusRedis, control);
  const mcpRegistry = new MCPRegistry();
  const environmentResolver = buildCompositeResolver(db, mcpRegistry, (data) => {
    // Fan out deployment status so API replicas emit WS events + deliver notifications.
    void publisher
      .publish(DEPLOYMENT_STATUS_CHANNEL, JSON.stringify(data))
      .catch((err) => {
        logger.warn({ err: err instanceof Error ? err.message : err, deploymentId: data.deploymentId }, "Redis deployment status publish failed");
      });
  });

  /** Direct bridge execution for git-backed checkpoints. */
  const execBridge = async (
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> => {
    const root = typeof input["root"] === "string" ? input["root"] : "";
    if (!root) throw Object.assign(new Error("missing root"), { code: "VALIDATION_ERROR" });
    const row = await db.bridgeProjectRoot.findFirst({
      where: { canonicalRootReference: root },
      select: { bridgeId: true },
    });
    if (!row) throw Object.assign(new Error("root not registered"), { code: "POLICY_DENIED" });
    const client = new BridgeGatewayClient({
      baseUrl: env.BRIDGE_GATEWAY_URL,
      internalToken: env.BRIDGE_INTERNAL_TOKEN,
    });
    const kind = toolName === "checkpoint.create" ? "ckpt.create" : "ckpt.rollback";
    const resp = await client.execute(row.bridgeId, kind, input, timeoutMs);
    if (!resp.ok) {
      throw Object.assign(new Error(resp.error?.message ?? "bridge failed"), {
        code: resp.error?.code ?? "BRIDGE_DISCONNECTED",
      });
    }
    return resp.data ?? {};
  };

  const runtime = buildAgentRuntime({
    prisma: db,
    logger,
    environmentResolver,
    control,
    execBridge,
    mcpRegistry,
    onTaskEvent: (taskId, event) => {
      // Persisted already; fan out through Redis so any API replica emits it.
      void publisher
        .publish(TASK_EVENTS_CHANNEL, JSON.stringify({ taskId, event }))
        .catch((err) => {
          logger.warn({ err: err instanceof Error ? err.message : err, taskId }, "Redis event publish failed");
        });
    },
    onApprovalCreated: (approval) => {
      void publisher
        .publish(APPROVAL_EVENTS_CHANNEL, JSON.stringify(approval))
        .catch((err) => {
          logger.warn({ err: err instanceof Error ? err.message : err, approvalId: approval.id }, "Redis approval event publish failed");
        });
    },
  });

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", (err) => logger.error({ err }, "worker connection redis error"));

  const statsQueue = new Queue("task-lifecycle", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      // Match the API producer's retention caps — recovery enqueues (orphan
      // re-starts, resume replays) otherwise keep job records forever.
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  });

  const worker = new Worker<TaskJob>(
    "task-lifecycle",
    async (job: Job<TaskJob>) => {
      const payload = job.data;
      logger.info({ jobId: job.id, kind: payload.kind, taskId: payload.taskId }, "processing task job");

      switch (payload.kind) {
        case "start": {
          const task = await db.task.findUniqueOrThrow({ where: { id: payload.taskId } });
          // Default execution path is memory-aware: retrieves project memories, injects into constraints, extracts learnings post-run.
          // MemoryAwareOrchestrator respects FeatureFlag `memory_enabled` per workspace (defaults to enabled).
          const outcome = await runtime.memoryOrchestrator.startRun({
            taskId: task.id,
            runId: "",
            workspaceId: task.workspaceId,
            projectId: task.projectId,
            userId: task.createdBy,
            goal: task.goal,
            constraints: task.constraints,
            agentMode: (task.agentMode as "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX") ?? "BUILD",
            selectedModelMode: task.selectedModelMode,
            modelOverride:
              task.overrideProviderConnectionId && task.overrideModelIdentifier
                ? {
                    providerConnectionId: task.overrideProviderConnectionId,
                    modelIdentifier: task.overrideModelIdentifier,
                  }
                : null,
            workspaceInstructionVersion: null,
            policySnapshotId: "",
          });
          // Persist observability traces for this task
          const traces = runtime.traceCollector.getTracesByTask(task.id);
          for (const trace of traces) {
            await runtime.tracePersistence.saveTrace(trace).catch((err) => {
              logger.warn({ err: err instanceof Error ? err.message : err, taskId: task.id }, "Trace persistence failed");
            });
          }
          logger.info({ taskId: task.id, outcome, tracesPersisted: traces.length }, "run finished");
          // Send notification on task completion
          if (outcome === "COMPLETED") {
            await sendTaskNotification(task.id, task.workspaceId, "completed").catch((err) => {
              logger.warn({ err: err instanceof Error ? err.message : err, taskId: task.id }, "Task completion notification failed");
            });
          }
          return outcome;
        }
        case "resume-approved-plan": {
          const outcome = await runtime.orchestrator.approvePlanAndExecute({
            taskId: payload.taskId,
            userId: payload.userId,
          });
          logger.info({ taskId: payload.taskId, outcome }, "resumed after plan approval");
          return outcome;
        }
        case "continue-after-tool-decision": {
          const outcome = await runtime.orchestrator.continueAfterToolDecision({
            taskId: payload.taskId,
          });
          logger.info({ taskId: payload.taskId, outcome }, "continued after tool decision");
          return outcome;
        }
        case "revise-plan": {
          const outcome = await runtime.orchestrator.revisePlan({
            taskId: payload.taskId,
            userId: payload.userId,
            instruction: payload.instruction,
          });
          return outcome;
        }
        default:
          throw new Error(`Unknown job kind: ${(payload as { kind: string }).kind}`);
      }
    },
    {
      connection,
      concurrency: env.WORKER_CONCURRENCY,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400 },
      lockDuration: 300_000,
      stalledInterval: 60_000,
    },
  );

  // Job failures have no BullMQ retries configured (attempts=1) — the task must
  // be terminal-ized or it stays QUEUED forever and the orphan sweeper
  // re-enqueues it on every cycle (observed: 30s infinite re-enqueue loop).
  const terminalTaskStates = new Set(["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]);

  async function finalizeFailedTask(taskId: string, failureMessage: string): Promise<void> {
    const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, state: true } });
    if (!task || terminalTaskStates.has(task.state)) return;
    const run = await db.taskRun.findFirst({
      where: { taskId: task.id },
      orderBy: { startedAt: "desc" },
      select: { id: true, state: true },
    });
    const now = new Date();
    const runFailed = run !== null && !terminalTaskStates.has(run.state);
    await db.$transaction([
      db.task.update({ where: { id: task.id }, data: { state: "FAILED", completedAt: now } }),
      ...(runFailed
        ? [db.taskRun.update({
            where: { id: (run as { id: string }).id },
            data: { state: "FAILED", endedAt: now, failureCode: "JOB_FAILED", failureMessage },
          })]
        : []),
    ]);
    await runtime.events.publishAndEmit({
      taskId: task.id,
      runId: runFailed ? (run as { id: string }).id : null,
      eventType: TASK_EVENT_TYPES.RUN_FAILED,
      actorType: "SYSTEM",
      payload: { failureCode: "JOB_FAILED", failureMessage },
    });
    logger.info({ taskId: task.id }, "task marked FAILED");
  }

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, taskId: job?.data?.taskId, err: redactValue(err.stack ?? err.message) },
      "task job failed",
    );
    if (!job?.data?.taskId) return;
    const taskId = job.data.taskId;
    const failureMessage = (err?.message ?? String(err)).slice(0, 2000);
    db.task.findUnique({ where: { id: taskId }, select: { workspaceId: true } })
      .then((task) => {
        if (task) {
          void sendTaskNotification(taskId, task.workspaceId, "failed", failureMessage).catch((notifyErr) => {
            logger.warn({ err: notifyErr instanceof Error ? notifyErr.message : notifyErr, taskId }, "Task failure notification failed");
          });
        }
      })
      .catch((dbErr) => {
        logger.warn({ err: dbErr instanceof Error ? dbErr.message : dbErr, taskId }, "Failed to look up task for failure notification");
      });
    finalizeFailedTask(taskId, failureMessage).catch((dbErr) => {
      logger.warn({ err: dbErr instanceof Error ? dbErr.message : dbErr, taskId }, "Failed to finalize failed task");
    });
  });

  worker.on("error", (err) => {
    logger.error({ err: err.message }, "worker error");
  });

  // ── Approval expiry sweeper (APP_FLOW §14) ────────────────
  let stopped = false;
  const sweepTimer = setInterval(async () => {
    if (stopped) return;
    try {
      // ── Approval expiry sweep ──
      try {
        await expireStaleApprovals({
          db,
          events: runtime.events,
          enqueue: async (job) => {
            const jobId =
              job.kind === "continue-after-tool-decision"
                ? `continue-after-tool-decision-${job.taskId}-${job.approvalId}`
                : `${job.kind}-${job.taskId}`;
            await statsQueue.add(job.kind, job, { jobId });
          },
          logger,
        });
      } catch (err) {
        logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "approval expiry sweep failed");
      }

      // ── MCP server health checks (HTTP/SSE only) ──
      try {
        const activeServers = await db.mcpServer.findMany({
          where: { status: "ACTIVE", transportType: { not: "STDIO" } },
          take: 50,
        });
        for (const server of activeServers) {
          try {
            const cfg = JSON.parse(
              Buffer.from(server.encryptedConfig).length
                ? (await import("@ai-harness/shared")).decryptSecret(Buffer.from(server.encryptedConfig), env.ENCRYPTION_KEY)
                : "{}",
            ) as { url?: string };
            if (!cfg.url) continue;
            const res = await fetch(cfg.url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
              signal: AbortSignal.timeout(8_000),
            });
            await db.mcpServer.update({
              where: { id: server.id },
              data: { status: res.ok ? "ACTIVE" : "ERROR" },
            });
          } catch {
            await db.mcpServer.update({ where: { id: server.id }, data: { status: "ERROR" } });
            logger.warn({ serverId: server.id }, "mcp server marked ERROR after failed health check");
          }
        }
      } catch (err) {
        logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "MCP health check sweep failed");
      }

      // ── Orphaned QUEUED task recovery (transactional outbox) ──
      // Tasks that were created but never enqueued (API crash between create+enqueue)
      // are stuck in QUEUED with no TaskRun and no active BullMQ job.
      try {
        const orphanCutoff = new Date(Date.now() - 2 * 60_000);
        const orphans = await db.task.findMany({
          where: { state: "QUEUED", createdAt: { lt: orphanCutoff } },
          select: { id: true },
          take: 20,
        });
        for (const orphan of orphans) {
          const hasRun = await db.taskRun.findFirst({ where: { taskId: orphan.id }, select: { id: true } });
          if (hasRun) continue; // Has a run — handled by stuck-run recovery below
          const job = await statsQueue.getJob(`start-${orphan.id}`);
          if (job) {
            const jobState = await job.getState();
            if (jobState === "waiting" || jobState === "active" || jobState === "delayed" || jobState === "prioritized" || jobState === "waiting-children") {
              continue; // Still queued/in-flight — another sweeper cycle may have enqueued
            }
            // Finished job (failed/completed) but task still QUEUED: re-adding the
            // same jobId is a BullMQ no-op, which caused an infinite re-enqueue
            // loop. Finalize the task instead.
            try {
              await finalizeFailedTask(orphan.id, `start job ${jobState} while task still QUEUED`);
            } catch (err) {
              logger.warn({ err, taskId: orphan.id }, "orphan finalization failed");
            }
            continue;
          }
          try {
            await statsQueue.add("start", { kind: "start", taskId: orphan.id }, { jobId: `start-${orphan.id}` });
            logger.info({ taskId: orphan.id }, "orphaned QUEUED task re-enqueued (outbox recovery)");
          } catch (err) {
            // jobId conflict = another process already enqueued — safe to ignore
            const isConflict = (err as { code?: string })?.code === "EJOBIDEXISTS" || String(err).includes("JobId");
            if (!isConflict) logger.warn({ err, taskId: orphan.id }, "orphan re-enqueue failed");
          }
        }
      } catch (err) {
        logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "orphaned QUEUED task sweep failed");
      }

      // ── Approved-plan resume recovery ─────────────────────────────
      // plans.routes promises "scheduling can be retried by the sweeper" when
      // the post-approval enqueue fails/drops — recover those tasks here.
      // (BullMQ no-ops re-adds of finished jobIds, which used to strand tasks
      // in WAITING_FOR_APPROVAL with an APPROVED plan forever.)
      try {
        const waiting = await db.task.findMany({
          where: { state: "WAITING_FOR_APPROVAL" },
          select: { id: true, createdBy: true },
          take: 20,
        });
        for (const t of waiting) {
          const latest = await db.taskPlan.findFirst({
            where: { taskId: t.id },
            orderBy: { version: "desc" },
            select: { id: true, status: true },
          });
          if (!latest || latest.status !== "APPROVED") continue;
          const resumeJobId = `resume-approved-plan-${t.id}-${latest.id}`;
          const job = await statsQueue.getJob(resumeJobId);
          if (job) {
            const st = await job.getState();
            if (st === "waiting" || st === "active" || st === "delayed" || st === "prioritized" || st === "waiting-children") {
              continue; // resume in flight
            }
            // Finished resume but the task still waits — the run did not transition.
            await finalizeFailedTask(t.id, `resume job ${st} while task still WAITING_FOR_APPROVAL`).catch((err) => {
              logger.warn({ err, taskId: t.id }, "stalled resume finalization failed");
            });
            continue;
          }
          try {
            await statsQueue.add(
              "resume-approved-plan",
              { kind: "resume-approved-plan", taskId: t.id, userId: t.createdBy, planId: latest.id },
              { jobId: resumeJobId },
            );
            logger.info({ taskId: t.id, planId: latest.id }, "approved plan re-enqueued (resume recovery)");
          } catch (err) {
            logger.warn({ err, taskId: t.id }, "approved plan resume re-enqueue failed");
          }
        }
      } catch (err) {
        logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "approved plan resume sweep failed");
      }

      // ── Stuck-run recovery: runs whose worker died mid-flight ──
      try {
        await sweepStuckRuns({ db, events: runtime.events, logger });
      } catch (err) {
        logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "stuck-run recovery sweep failed");
      }

      // ── Scheduled tasks: fire due schedules (APP_FLOW §18) ───────
      try {
        const fired = await sweepDueSchedules({
          db,
          events: runtime.events,
          enqueue: async (job) => {
            try {
              await statsQueue.add(job.kind, job, { jobId: `start-${job.taskId}` });
            } catch (err) {
              const isConflict =
                (err as { code?: string })?.code === "EJOBIDEXISTS" || String(err).includes("JobId");
              if (!isConflict) throw err;
            }
          },
          logger,
        });
        if (fired > 0) logger.info({ metric: "scheduled_tasks_fired", fired }, "scheduled tasks fired");
      } catch (err) {
        logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "schedule sweep failed");
      }

      // ── Expired backup cleanup (TTL: 7 days, runs every hour) ──
      try {
        const lastBackupCleanup = (globalThis as unknown as { __lastBackupCleanup?: number }).__lastBackupCleanup ?? 0;
        if (Date.now() - lastBackupCleanup > 60 * 60 * 1000) {
          (globalThis as unknown as { __lastBackupCleanup: number }).__lastBackupCleanup = Date.now();
          const backupCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const removed = await db.workspaceBackup.deleteMany({
            where: { createdAt: { lt: backupCutoff } },
          });
          if (removed.count > 0) logger.info({ count: removed.count }, "expired backups cleaned up");
        }
      } catch (err) {
        logger.warn({ err: redactValue(err instanceof Error ? err.message : err) }, "backup cleanup sweep failed");
      }

      // ── Stale queue-job hygiene: reap old completed/failed job records ──
      // Count caps on defaultJobOptions only bound NEW jobs; age-based clean
      // also drains the legacy backlog and worker-enqueued recovery jobs.
      try {
        const lastQueueCleanup = (globalThis as unknown as { __lastQueueCleanup?: number }).__lastQueueCleanup ?? 0;
        if (Date.now() - lastQueueCleanup > QUEUE_RETENTION.cleanupIntervalMs) {
          (globalThis as unknown as { __lastQueueCleanup: number }).__lastQueueCleanup = Date.now();
          const removed = await cleanStaleJobs(statsQueue);
          if (removed.completed > 0 || removed.failed > 0) {
            logger.info(
              { metric: "queue_jobs_cleaned", completed: removed.completed, failed: removed.failed },
              "stale queue jobs cleaned",
            );
          }
        }
      } catch (err) {
        logger.warn({ err: redactValue(err instanceof Error ? err.message : err) }, "queue hygiene sweep failed");
      }

      // ── Queue observability metrics ──
      try {
        const counts = await statsQueue.getJobCounts("wait", "active", "completed", "failed");
        logger.info(
          {
            metric: "queue_depth",
            waiting: counts.wait ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
          },
          "queue stats",
        );
      } catch (err) {
        logger.warn({ err: redactValue(err instanceof Error ? err.message : err) }, "queue stats sweep failed");
      }

      // ── Webhook delivery sweep ──
      try {
        const pendingWebhooks = await db.webhookDeliveryLog.findMany({
          where: {
            status: "PENDING",
            OR: [
              { nextRetryAt: null },
              { nextRetryAt: { lte: new Date() } },
            ],
          },
          include: { subscription: true },
          orderBy: { createdAt: "asc" },
          take: 20,
        });

        for (const delivery of pendingWebhooks) {
          const sub = delivery.subscription;
          if (!sub || sub.status !== "ACTIVE") {
            await db.webhookDeliveryLog.update({
              where: { id: delivery.id },
              data: { status: "DEAD", lastError: "Subscription inactive" },
            });
            continue;
          }

          try {
            const body = JSON.stringify(delivery.payload);
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              "X-Webhook-Event": delivery.event,
              "X-Webhook-Timestamp": new Date().toISOString(),
            };
            if (sub.secret) {
              const crypto = await import("node:crypto");
              const sig = crypto.createHmac("sha256", sub.secret).update(body).digest("hex");
              headers["X-Webhook-Signature"] = `sha256=${sig}`;
            }

            const resp = await fetch(sub.url, {
              method: "POST",
              headers,
              body,
              signal: AbortSignal.timeout(10_000),
            });

            const newAttempt = delivery.attemptCount + 1;
            if (resp.ok) {
              await db.webhookDeliveryLog.update({
                where: { id: delivery.id },
                data: { status: "DELIVERED", attemptCount: newAttempt, deliveredAt: new Date() },
              });
            } else if (newAttempt >= delivery.maxAttempts) {
              await db.webhookDeliveryLog.update({
                where: { id: delivery.id },
                data: { status: "DEAD", attemptCount: newAttempt, lastError: `HTTP ${resp.status}` },
              });
            } else {
              const delays = [5_000, 30_000, 120_000, 600_000];
              const nextRetry = delays[newAttempt] ? new Date(Date.now() + delays[newAttempt]) : null;
              await db.webhookDeliveryLog.update({
                where: { id: delivery.id },
                data: { attemptCount: newAttempt, lastError: `HTTP ${resp.status}`, nextRetryAt: nextRetry },
              });
            }
          } catch (err) {
            const newAttempt = delivery.attemptCount + 1;
            if (newAttempt >= delivery.maxAttempts) {
              await db.webhookDeliveryLog.update({
                where: { id: delivery.id },
                data: { status: "DEAD", attemptCount: newAttempt, lastError: (err as Error).message },
              });
            } else {
              const delays = [5_000, 30_000, 120_000, 600_000];
              const nextRetry = delays[newAttempt] ? new Date(Date.now() + delays[newAttempt]) : null;
              await db.webhookDeliveryLog.update({
                where: { id: delivery.id },
                data: { attemptCount: newAttempt, lastError: (err as Error).message, nextRetryAt: nextRetry },
              });
            }
          }
        }
      } catch (err) {
        logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "webhook sweep failed");
      }
    } catch (err) {
      logger.error({ err: redactValue(err instanceof Error ? err.message : err) }, "approval sweep failed");
    }
  }, 30_000);

  async function shutdown(signal: string) {
    logger.info({ signal }, "worker shutting down");
    stopped = true;
    clearInterval(sweepTimer);
    await statsQueue.close().catch(() => undefined);
    const closePromise = worker.close();
    const timeout = new Promise<void>((resolve) => setTimeout(() => resolve(), 10_000));
    await Promise.race([closePromise, timeout]);
    await publisher.quit().catch(() => undefined);
    await connection.quit().catch(() => undefined);
    await controlBusRedis.quit().catch(() => undefined);
    await db.$disconnect().catch(() => undefined);
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info({ concurrency: env.WORKER_CONCURRENCY, queue: "task-lifecycle" }, "AI Harness worker ready");
}

main().catch((err) => {
  process.stderr.write(`FATAL: AI Harness worker failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
