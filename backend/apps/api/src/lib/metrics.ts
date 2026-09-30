import { MetricsCollector } from "@ai-harness/metrics-collector";
import type { QueueCounts } from "./task-queue.js";

/**
 * Process-wide API metrics singleton. Recorded by the response-headers plugin
 * (http_requests_total / http_request_duration_ms / http_errors_total) and
 * exported by GET /metrics and GET /v1/admin/metrics.
 */
export const apiMetrics = new MetricsCollector();

/**
 * Prometheus gauge lines for task-queue depth, including the failed count
 * (appended to the /metrics scrape alongside http/process gauges).
 */
export function queueCountsToPrometheus(counts: QueueCounts): string {
  const states: Array<[string, number]> = [
    ["waiting", counts.waiting],
    ["active", counts.active],
    ["completed", counts.completed],
    ["failed", counts.failed],
    ["delayed", counts.delayed],
  ];
  const lines = ["# TYPE queue_jobs gauge"];
  for (const [state, value] of states) {
    lines.push(`queue_jobs{state="${state}"} ${value}`);
  }
  return lines.join("\n") + "\n";
}
