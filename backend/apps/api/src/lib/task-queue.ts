import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { getEnv, TASK_QUEUE, type TaskJob } from "@ai-harness/shared";

export type JobPriority = "high" | "medium" | "low";

const PRIORITY_MAP: Record<JobPriority, number> = {
  high: 1,
  medium: 5,
  low: 10,
};

let queue: Queue<TaskJob> | null = null;

/** Lazily creates the BullMQ producer. Throws so callers can degrade clearly. */
export function getTaskQueue(): Queue<TaskJob> {
  if (!queue) {
    const env = getEnv();
    const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    connection.on("error", () => undefined);
    queue = new Queue<TaskJob>(TASK_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return queue;
}

/**
 * Occurrence-unique jobIds per logical intent.
 * BullMQ treats re-adding an existing (completed/failed) jobId as a no-op, so a
 * stable `${kind}-${taskId}` id silently drops the 2nd resume/revise/continue of
 * the same task (observed: approved plan never resumed). `start` keeps the
 * stable id (a task starts once; retries dedupe against pending jobs).
 */
function jobIdFor(job: TaskJob): string {
  switch (job.kind) {
    case "resume-approved-plan":
      return `resume-approved-plan-${job.taskId}-${job.planId}`;
    case "continue-after-tool-decision":
      return `continue-after-tool-decision-${job.taskId}-${job.approvalId}`;
    case "revise-plan":
      return `revise-plan-${job.taskId}-${job.requestId}`;
    default:
      return `${job.kind}-${job.taskId}`;
  }
}

/**
 * Enqueue a task job with optional priority.
 * @param job The task job payload
 * @param priority Job priority (high, medium, low). Default medium.
 */
export async function enqueueTaskJob(
  job: TaskJob,
  priority: JobPriority = "medium",
): Promise<void> {
  // BullMQ rejects ":" in custom jobIds ("Custom Id cannot contain :")
  // unless it is a 3-part legacy repeat id - use "-" as the separator.
  const q = getTaskQueue();

  // Deduplication: check for active/waiting jobs with the same kind+taskId
  const existing = await q.getJobs(["active", "waiting"]);
  const isDuplicate = existing.some(
    (j) => j.name === job.kind && j.data.taskId === job.taskId,
  );
  if (isDuplicate) return;

  await q.add(job.kind, job, {
    priority: PRIORITY_MAP[priority],
    jobId: jobIdFor(job),
  });
}

/**
 * Enqueue a task job with a delay (in ms).
 */
export async function enqueueTaskJobDelayed(
  job: TaskJob,
  delayMs: number,
  priority: JobPriority = "medium",
): Promise<void> {
  await getTaskQueue().add(job.kind, job, {
    priority: PRIORITY_MAP[priority],
    delay: delayMs,
  });
}

/**
 * Get progress for a job by its deduplication key.
 */
export async function getJobProgress(taskId: string): Promise<{
  percentage: number;
  message?: string;
} | null> {
  const q = getTaskQueue();
  const jobs = await q.getJobs(["active", "waiting", "completed", "failed"]);
  const job = jobs.find((j) => j.data.taskId === taskId);
  if (!job || !job.progress) return null;
  const progress = job.progress as { percentage?: number; message?: string };
  return { percentage: progress.percentage ?? 0, message: progress.message };
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Live job counts for the task queue, resolved through TASK_QUEUE so callers
 * can never point at a stale/renamed Redis key prefix (the old admin stats
 * read `bull:ai-harness-tasks:*` while the queue is `task-lifecycle` — always
 * zeros). Throws when Redis is unavailable; callers degrade to zeros/skip.
 */
export async function getQueueCounts(): Promise<QueueCounts> {
  const counts = await getTaskQueue().getJobCounts("wait", "active", "completed", "failed", "delayed");
  return {
    waiting: counts.wait ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}
