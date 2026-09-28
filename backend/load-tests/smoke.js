import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";

const errorRate = new Rate("errors");
const healthLatency = new Trend("health_latency", true);
const apiHealthLatency = new Trend("api_health_latency", true);

export const options = {
  stages: [
    { duration: "10s", target: 2 },
    { duration: "15s", target: 2 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<300"],
    http_req_failed: ["rate<0.05"],
    errors: ["rate<0.05"],
  },
};

export default function () {
  const res1 = http.get(`${BASE_URL}/healthz`);
  healthLatency.add(res1.timings.duration);
  check(res1, {
    "health status 200": (r) => r.status === 200,
    "health latency < 200ms": (r) => r.timings.duration < 200,
  }) || errorRate.add(1);

  const res2 = http.get(`${BASE_URL}/api/healthz`);
  apiHealthLatency.add(res2.timings.duration);
  check(res2, {
    "api health status 200": (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(0.5);
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs?.values?.count || 0;
  const failed = (data.metrics.http_req_failed?.values?.rate || 0) * 100;
  const p95 = data.metrics.http_req_duration?.values?.["p(95)"] || 0;

  const lines = [
    "",
    "╔═══════════════════════════════════════╗",
    "║      Smoke Test Results               ║",
    "╠═══════════════════════════════════════╣",
    `║  Requests:  ${String(total).padStart(6)}`,
    `║  Failed:    ${failed.toFixed(1).padStart(5)}%`,
    `║  P95:       ${p95.toFixed(0).padStart(6)}ms`,
    "╚═══════════════════════════════════════╝",
    "",
  ];

  return {
    stdout: lines.join("\n"),
  };
}
