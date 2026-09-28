import { MetricsCollector } from "@ai-harness/metrics-collector";

/**
 * Process-wide API metrics singleton. Recorded by the response-headers plugin
 * (http_requests_total / http_request_duration_ms / http_errors_total) and
 * exported by GET /metrics and GET /v1/admin/metrics.
 */
export const apiMetrics = new MetricsCollector();
