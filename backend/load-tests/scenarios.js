import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const SCENARIO = __ENV.SCENARIO || "health";

const errorRate = new Rate("errors");
const healthLatency = new Trend("health_latency", true);
const authLatency = new Trend("auth_latency", true);
const taskLatency = new Trend("task_latency", true);
const signupCount = new Counter("signups");

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

function testHealth() {
  const res = http.get(`${BASE_URL}/healthz`);
  healthLatency.add(res.timings.duration);

  check(res, {
    "health status 200": (r) => r.status === 200,
    "health latency < 200ms": (r) => r.timings.duration < 200,
  }) || errorRate.add(1);
}

function testAuth() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2);
  const payload = JSON.stringify({
    email: `loadtest-${ts}-${rand}@example.com`,
    password: "TestPassword123!",
    displayName: "Load Test User",
  });

  const res = http.post(`${BASE_URL}/v1/auth/signup`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  authLatency.add(res.timings.duration);
  signupCount.add(1);

  check(res, {
    "signup status 201 or 409": (r) => r.status === 201 || r.status === 409,
    "signup latency < 1000ms": (r) => r.timings.duration < 1000,
  }) || errorRate.add(1);
}

function testProtectedUnauth() {
  const res = http.get(`${BASE_URL}/v1/tasks`);
  check(res, {
    "unauth returns 401": (r) => r.status === 401,
  }) || errorRate.add(1);
}

function testProtectedWithToken() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2);
  const signupPayload = JSON.stringify({
    email: `loadtest-${ts}-${rand}@example.com`,
    password: "TestPassword123!",
    displayName: "Load Test User",
  });

  const signupRes = http.post(`${BASE_URL}/v1/auth/signup`, signupPayload, {
    headers: { "Content-Type": "application/json" },
  });

  if (signupRes.status !== 201 && signupRes.status !== 409) {
    errorRate.add(1);
    return;
  }

  const body = signupRes.json();
  const token = body?.data?.accessToken;
  if (!token) {
    errorRate.add(1);
    return;
  }

  const tasksRes = http.get(`${BASE_URL}/v1/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  taskLatency.add(tasksRes.timings.duration);

  check(tasksRes, {
    "tasks list returns 200": (r) => r.status === 200,
    "tasks latency < 500ms": (r) => r.timings.duration < 500,
  }) || errorRate.add(1);
}

function testWorkspacesFlow() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2);
  const signupPayload = JSON.stringify({
    email: `loadtest-ws-${ts}-${rand}@example.com`,
    password: "TestPassword123!",
    displayName: "Load Test WS User",
  });

  const signupRes = http.post(`${BASE_URL}/v1/auth/signup`, signupPayload, {
    headers: { "Content-Type": "application/json" },
  });

  if (signupRes.status !== 201 && signupRes.status !== 409) {
    errorRate.add(1);
    return;
  }

  const token = signupRes.json()?.data?.accessToken;
  if (!token) {
    errorRate.add(1);
    return;
  }

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const listRes = http.get(`${BASE_URL}/v1/workspaces`, { headers: authHeaders });
  check(listRes, {
    "list workspaces 200": (r) => r.status === 200,
  }) || errorRate.add(1);

  const createRes = http.post(
    `${BASE_URL}/v1/workspaces`,
    JSON.stringify({
      name: `Load Test Workspace ${rand}`,
      executionMode: "CLOUD",
    }),
    { headers: authHeaders },
  );
  check(createRes, {
    "create workspace 201": (r) => r.status === 201,
    "create workspace < 800ms": (r) => r.timings.duration < 800,
  }) || errorRate.add(1);
}

export default function () {
  if (SCENARIO === "health") {
    testHealth();
  } else if (SCENARIO === "auth") {
    testAuth();
  } else if (SCENARIO === "protected") {
    testProtectedWithToken();
  } else if (SCENARIO === "workspaces") {
    testWorkspacesFlow();
  } else if (SCENARIO === "mixed") {
    const rand = Math.random();
    if (rand < 0.3) {
      testHealth();
    } else if (rand < 0.5) {
      testProtectedUnauth();
    } else if (rand < 0.7) {
      testAuth();
    } else if (rand < 0.9) {
      testProtectedWithToken();
    } else {
      testWorkspacesFlow();
    }
  }

  sleep(0.1);
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs?.values?.count || 0;
  const failed = (data.metrics.http_req_failed?.values?.rate || 0) * 100;
  const avg = data.metrics.http_req_duration?.values?.avg || 0;
  const p95 = data.metrics.http_req_duration?.values?.["p(95)"] || 0;
  const p99 = data.metrics.http_req_duration?.values?.["p(99)"] || 0;
  const signups = data.metrics.signups?.values?.count || 0;

  const lines = [
    "",
    "╔═══════════════════════════════════════════╗",
    `║  Load Test Results (${SCENARIO.padEnd(10)})       ║`,
    "╠═══════════════════════════════════════════╣",
    `║  Requests:   ${String(total).padStart(8)}`,
    `║  Failed:     ${failed.toFixed(1).padStart(6)}%`,
    `║  Avg:        ${avg.toFixed(0).padStart(6)}ms`,
    `║  P95:        ${p95.toFixed(0).padStart(6)}ms`,
    `║  P99:        ${p99.toFixed(0).padStart(6)}ms`,
    `║  Signups:    ${String(signups).padStart(8)}`,
    "╚═══════════════════════════════════════════╝",
    "",
  ];

  return {
    stdout: lines.join("\n"),
    "backend/load-tests/results.json": JSON.stringify({
      scenario: SCENARIO,
      totalRequests: total,
      errorRate: failed / 100,
      avgLatencyMs: avg,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      signups,
      timestamp: new Date().toISOString(),
    }),
  };
}
