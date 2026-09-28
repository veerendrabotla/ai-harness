import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { getEnv } from "@ai-harness/shared";
import pino from "pino";

const log = pino({ name: "job-scheduler", level: "warn" });

export type JobPriority = "high" | "medium" | "low";

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  payload: unknown;
  priority?: JobPriority;
  enabled?: boolean;
}

export interface JobProgress {
  jobId: string;
  percentage: number;
  message?: string;
  timestamp: number;
}

const PRIORITY_MAP: Record<JobPriority, number> = {
  high: 1,
  medium: 5,
  low: 10,
};

const DEDUP_WINDOW_MS = 5_000;

let schedulerQueue: Queue | null = null;
let schedulerWorker: Worker | null = null;
const recentJobKeys = new Map<string, number>();

function getSchedulerConnection(): Redis {
  const env = getEnv();
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", () => undefined);
  return connection;
}

export function getSchedulerQueue(): Queue {
  if (!schedulerQueue) {
    schedulerQueue = new Queue("job-scheduler", {
      connection: getSchedulerConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return schedulerQueue;
}

/**
 * Deduplicate a job by key. Returns true if the job is a duplicate and should be skipped.
 */
export function isDuplicateJob(key: string): boolean {
  const now = Date.now();
  const lastRun = recentJobKeys.get(key);
  if (lastRun && now - lastRun < DEDUP_WINDOW_MS) {
    return true;
  }
  recentJobKeys.set(key, now);
  // Cleanup old entries
  if (recentJobKeys.size > 10_000) {
    for (const [k, t] of recentJobKeys) {
      if (now - t > DEDUP_WINDOW_MS * 2) recentJobKeys.delete(k);
    }
  }
  return false;
}

/**
 * Enqueue a job with priority and optional deduplication.
 */
export async function enqueueJob<T = unknown>(
  name: string,
  data: T,
  opts: {
    priority?: JobPriority;
    dedupeKey?: string;
    delay?: number;
    jobId?: string;
  } = {},
): Promise<Job<T> | null> {
  if (opts.dedupeKey && isDuplicateJob(opts.dedupeKey)) {
    return null;
  }

  const options: JobsOptions = {};
  if (opts.priority) options.priority = PRIORITY_MAP[opts.priority];
  if (opts.delay) options.delay = opts.delay;
  if (opts.jobId) options.jobId = opts.jobId;

  return getSchedulerQueue().add(name, data as never, options);
}

/**
 * Report job progress (percentage 0-100).
 */
export async function reportJobProgress(
  queueName: string,
  jobId: string,
  percentage: number,
  message?: string,
): Promise<void> {
  const env = getEnv();
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", () => undefined);
  try {
    const queue = new Queue(queueName, { connection });
    const job = await queue.getJob(jobId);
    if (job) {
      await job.updateProgress({ percentage: Math.min(100, Math.max(0, percentage)), message });
    }
    await queue.close();
  } finally {
    connection.disconnect();
  }
}

/**
 * Start the scheduler worker that processes cron-based jobs.
 */
export function startSchedulerWorker(
  processor: (job: Job) => Promise<unknown>,
): void {
  if (schedulerWorker) return;
  schedulerWorker = new Worker("job-scheduler", processor, {
    connection: getSchedulerConnection(),
    concurrency: 5,
  });
  schedulerWorker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Scheduler job failed:");
  });
}

export async function closeScheduler(): Promise<void> {
  if (schedulerWorker) {
    await schedulerWorker.close();
    schedulerWorker = null;
  }
  if (schedulerQueue) {
    await schedulerQueue.close();
    schedulerQueue = null;
  }
}

/**
 * Repeatable job management: add or update a cron-scheduled job.
 */
export async function upsertScheduledJob(
  job: ScheduledJob,
): Promise<void> {
  const queue = getSchedulerQueue();
  const existing = await queue.getJob(job.id);
  if (existing) {
    await existing.updateData(job.payload);
    return;
  }
  if (job.enabled === false) return;

  await queue.add(
    job.name,
    job.payload,
    {
      jobId: job.id,
      repeat: { pattern: job.cron },
      priority: job.priority ? PRIORITY_MAP[job.priority] : undefined,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );
}

export async function removeScheduledJob(jobId: string): Promise<void> {
  const queue = getSchedulerQueue();
  const repeats = await queue.getRepeatableJobs();
  const match = repeats.find((r) => r.id === jobId);
  if (match) {
    await queue.removeRepeatableByKey(match.key);
  }
}
