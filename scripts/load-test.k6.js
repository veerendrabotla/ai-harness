// k6 load test script for AI Harness API
// Run: k6 run scripts/load-test.k6.js
// Or with custom target: k6 run --env BASE_URL=http://your-api scripts/load-test.k6.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";

const errorRate = new Rate("errors");
const healthLatency = new Trend("health_latency", true);
const authLatency = new Trend("auth_latency", true);

export const options = {
  stages: [
    { duration: "30s", target: 10, name: "Warm up" },
    { duration: "1m", target: 50, name: "Ramp up" },
    { duration: "2m", target: 50, name: "Sustained load" },
    { duration: "30s", target: 100, name: "Spike" },
    { duration: "1m", target: 100, name: "Sustained spike" },
    { duration: "30s", target: 0, name: "Cooldown" },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.1"],
    errors: ["rate<0.1"],
  },
};

export default function () {
  const scenario = __ENV.SCENARIO || "health";

  if (scenario === "health") {
    testHealth();
  } else if (scenario === "auth") {
    testAuth();
  } else if (scenario === "mixed") {
    const rand = Math.random();
    if (rand < 0.5) {
      testHealth();
    } else if (rand < 0.8) {
      testProtectedUnauth();
    } else {
      testAuth();
    }
  }

  sleep(0.1);
}

function testHealth() {
  const res = http.get(`${BASE_URL}/healthz`);
  healthLatency.add(res.timings.duration);

  check(res, {
    "health status is 200": (r) => r.status === 200,
    "health response time < 200ms": (r) => r.timings.duration < 200,
  }) || errorRate.add(1);
}

function testAuth() {
  const payload = JSON.stringify({
    email: `loadtest-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "TestPassword123!",
    displayName: "Load Test User",
  });

  const res = http.post(`${BASE_URL}/v1/auth/signup`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  authLatency.add(res.timings.duration);

  check(res, {
    "signup status is 201 or 409": (r) => r.status === 201 || r.status === 409,
    "signup response time < 1000ms": (r) => r.timings.duration < 1000,
  }) || errorRate.add(1);
}

function testProtectedUnauth() {
  const res = http.get(`${BASE_URL}/v1/tasks`);

  check(res, {
    "unauth returns 401": (r) => r.status === 401,
  }) || errorRate.add(1);
}

export function handleSummary(data) {
  const successes = data.metrics.http_reqs?.values?.count || 0;
  const failures = data.metrics.http_req_failed?.values?.rate || 0;
  const avgDuration = data.metrics.http_req_duration?.values?.avg || 0;
  const p95Duration = data.metrics.http_req_duration?.values?.["p(95)"] || 0;

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
    "scripts/load-test-summary.json": JSON.stringify({
      totalRequests: successes,
      errorRate: failures,
      avgLatencyMs: avgDuration,
      p95LatencyMs: p95Duration,
      timestamp: new Date().toISOString(),
    }),
  };
}

function textSummary(data, options) {
  let summary = "\n═══════════════════════════════════════════\n";
  summary += "  AI Harness Load Test Results\n";
  summary += "═══════════════════════════════════════════\n\n";
  summary += `  Total Requests: ${data.metrics.http_reqs?.values?.count || 0}\n`;
  summary += `  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%\n`;
  summary += `  Avg Latency:     ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms\n`;
  summary += `  P95 Latency:     ${(data.metrics.http_req_duration?.values?.["p(95)"] || 0).toFixed(2)}ms\n`;
  summary += `  P99 Latency:     ${(data.metrics.http_req_duration?.values?.["p(99)"] || 0).toFixed(2)}ms\n`;
  summary += "\n═══════════════════════════════════════════\n";
  return summary;
}
