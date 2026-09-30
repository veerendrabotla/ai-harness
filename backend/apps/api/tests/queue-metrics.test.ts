import { describe, expect, it } from "vitest";
import { queueCountsToPrometheus } from "../src/lib/metrics.js";
import type { QueueCounts } from "../src/lib/task-queue.js";

const counts: QueueCounts = { waiting: 3, active: 2, completed: 10, failed: 7, delayed: 1 };

describe("queue metrics (Prometheus gauges)", () => {
  it("exposes the failed count and every queue state", () => {
    const text = queueCountsToPrometheus(counts);
    expect(text).toContain("# TYPE queue_jobs gauge");
    expect(text).toContain('queue_jobs{state="failed"} 7');
    expect(text).toContain('queue_jobs{state="waiting"} 3');
    expect(text).toContain('queue_jobs{state="active"} 2');
    expect(text).toContain('queue_jobs{state="completed"} 10');
    expect(text).toContain('queue_jobs{state="delayed"} 1');
  });

  it("emits zero gauges too — absence of failures must still scrape as 0", () => {
    const text = queueCountsToPrometheus({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
    expect(text).toContain('queue_jobs{state="failed"} 0');
    expect((text.match(/queue_jobs\{/g) ?? []).length).toBe(5);
  });

  it("is valid exposition format (one sample per line, trailing newline)", () => {
    const text = queueCountsToPrometheus(counts);
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(6); // help/type line + 5 samples
    expect(text.endsWith("\n")).toBe(true);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^queue_jobs\{state="\w+"\} \d+$/);
    }
  });
});
