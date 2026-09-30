import { describe, it, expect, vi } from "vitest";
import { cleanStaleJobs, QUEUE_RETENTION } from "./queue-hygiene.js";

function makeQueue(completedIds: string[] = [], failedIds: string[] = []) {
  const clean = vi.fn().mockImplementation(async (_grace: number, _limit: number, type?: string) => {
    if (type === "failed") return failedIds;
    if (type === "completed") return completedIds;
    return [];
  });
  return { clean };
}

describe("queue hygiene (stale job cleanup)", () => {
  it("cleans completed > 24h and failed > 7d with a bounded batch limit", async () => {
    const queue = makeQueue(["c1", "c2"], ["f1"]);
    const result = await cleanStaleJobs(queue);

    expect(queue.clean).toHaveBeenCalledTimes(2);
    expect(queue.clean).toHaveBeenNthCalledWith(
      1,
      QUEUE_RETENTION.completedGraceMs,
      QUEUE_RETENTION.cleanBatchLimit,
      "completed",
    );
    expect(queue.clean).toHaveBeenNthCalledWith(
      2,
      QUEUE_RETENTION.failedGraceMs,
      QUEUE_RETENTION.cleanBatchLimit,
      "failed",
    );
    expect(result).toEqual({ completed: 2, failed: 1 });
  });

  it("documents the retention constants (24h completed / 7d failed / hourly gate)", () => {
    expect(QUEUE_RETENTION.completedGraceMs).toBe(86_400_000);
    expect(QUEUE_RETENTION.failedGraceMs).toBe(604_800_000);
    expect(QUEUE_RETENTION.cleanupIntervalMs).toBe(3_600_000);
  });

  it("is idempotent on empty queues (nothing to remove)", async () => {
    const queue = makeQueue([], []);
    expect(await cleanStaleJobs(queue)).toEqual({ completed: 0, failed: 0 });
  });

  it("propagates Redis failures for the caller to log", async () => {
    const queue = { clean: vi.fn().mockRejectedValue(new Error("redis down")) };
    await expect(cleanStaleJobs(queue)).rejects.toThrow("redis down");
  });
});
