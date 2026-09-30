/**
 * Retention policy for task-lifecycle queue job records.
 *
 * BullMQ keeps completed/failed job records in Redis forever unless a job
 * option (`removeOnComplete`/`removeOnFail`) or an explicit `clean()` removes
 * them. The producer caps cover jobs enqueued with default options, but the
 * worker's recovery enqueues (orphan re-starts, resume replays) and any
 * pre-cap backlog need an age-based sweeper — hence this module.
 */
export const QUEUE_RETENTION = {
  /** Completed job records older than this are deleted by the sweeper. */
  completedGraceMs: 24 * 60 * 60 * 1000,
  /** Failed job records are kept one week for post-mortems, then deleted. */
  failedGraceMs: 7 * 24 * 60 * 60 * 1000,
  /** Cadence gate for the cleanup (hourly, checked inside the worker sweep). */
  cleanupIntervalMs: 60 * 60 * 1000,
  /** Max job ids removed per clean() call — bounds Redis work per cycle. */
  cleanBatchLimit: 10_000,
} as const;

/**
 * Narrow Queue surface used by the sweep (kept minimal so tests can mock it).
 * BullMQ v5 signature: `clean(grace, limit, type?) -> Promise<string[]>`.
 */
export interface CleanableQueue {
  clean(grace: number, limit: number, type?: "completed" | "failed"): Promise<string[]>;
}

export interface HygieneResult {
  completed: number;
  failed: number;
}

/**
 * Deletes stale completed/failed job records so Redis memory stays bounded
 * even for jobs enqueued without retention options. Idempotent — safe to run
 * on every interval tick. Returns removed job-id counts per state; throws on
 * Redis errors so the caller can log and retry next cycle.
 */
export async function cleanStaleJobs(queue: CleanableQueue): Promise<HygieneResult> {
  const removedCompleted = await queue.clean(
    QUEUE_RETENTION.completedGraceMs,
    QUEUE_RETENTION.cleanBatchLimit,
    "completed",
  );
  const removedFailed = await queue.clean(
    QUEUE_RETENTION.failedGraceMs,
    QUEUE_RETENTION.cleanBatchLimit,
    "failed",
  );
  return {
    completed: removedCompleted.length,
    failed: removedFailed.length,
  };
}
