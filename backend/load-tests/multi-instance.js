import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";

// PHASE 13 #13 â€” multi-instance local load test.
//
// Run against the compose-scaled API tier:
//   docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --scale api=2
//   # seed the fixed login account once (409 = already seeded):
//   curl -X POST http://localhost:4000/v1/auth/signup -H "Content-Type: application/json" -d "{\"email\":\"loadtest-lead@example.com\",\"password\":\"TestPassword123!\",\"displayName\":\"Load Test Lead\"}"
//   k6 run backend/load-tests/multi-instance.js
//   docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --scale api=1  # restore
//
// Traffic is pinned 50/50 across both replicas by VU parity (__VU % 2), so the
// report measures the two-instance tier deterministically (instance 1 =
// host 4000, instance 2 = host 4001). Arrival-rate executors: 10/s warm-up,
// 50/s sustained design load, then health-only cooldown to drain.
//
// Error budget (thresholds below) = local Docker tier SLO at the 50 rps
// design load, derived from measured baselines (server-side: load-phase
// p95 459/558ms per instance, p99 1493/1762ms; warm p95 ~118ms):
// p95 < 750ms (~35% headroom), p99 < 2500ms (~40% headroom), failure < 1%.
// k6 exits non-zero (99) on any threshold breach -> CI-gate semantics.
//
// CAPACITY PROBE (not part of this gate profile): a 75 rps spike scenario
// (rate 75, startTime 3m, duration 1m) was run 2026-10-01 and COLLAPSED the
// tier â€” server p95 6328/7096ms, p50 rose to 684/857ms, ~46% of requests
// exceeded 1s, backlog drained 20s into cooldown. Ceiling on this hardware is
// between 50 (sustained OK) and 75 (collapse) rps for the auth-heavy mix â€”
// see backend/load-tests/multi-instance-report.md for full evidence.

const I1 = __ENV.INSTANCE1 || "http://localhost:4000";
const I2 = __ENV.INSTANCE2 || "http://localhost:4001";

const errorRate = new Rate("errors");
const signupCount = new Counter("signups");

// 401 is an EXPECTED status for the unauthenticated-read scenario; without
// this, k6's http_req_failed would count 10% of traffic as failures.
http.setResponseCallback(http.expectedStatuses(200, 201, 401));

export const options = {
  scenarios: {
    warmup: {
      executor: "constant-arrival-rate",
      startTime: "0s",
      rate: 10,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: "mixed",
    },
    load: {
      executor: "constant-arrival-rate",
      startTime: "1m",
      rate: 50,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 200,
      maxVUs: 600,
      exec: "mixed",
    },
    cooldown: {
      executor: "constant-vus",
      startTime: "3m",
      vus: 1,
      duration: "15s",
      exec: "healthOnly",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  thresholds: {
    http_req_duration: ["p(95)<750", "p(99)<2500"],
    http_req_failed: ["rate<0.01"],
    errors: ["rate<0.01"],
    dropped_iterations: ["count<50"],
  },
};

function base() {
  return __VU % 2 === 0 ? I1 : I2;
}

function health(b) {
  const res = http.get(`${b}/healthz`);
  check(res, { "health 200": (r) => r.status === 200 }) || errorRate.add(1);
}

function signupTasks(b) {
  const email = `k6-${Date.now()}-${__VU}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = http.post(
    `${b}/v1/auth/signup`,
    JSON.stringify({ email, password: "TestPassword123!", displayName: "Load Test User" }),
    { headers: { "Content-Type": "application/json" } },
  );
  signupCount.add(1);
  if (!check(res, { "signup 201": (r) => r.status === 201 })) {
    errorRate.add(1);
    return;
  }
  const token = res.json("data.accessToken");
  const tasks = http.get(`${b}/v1/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(tasks, { "tasks 200": (r) => r.status === 200 }) || errorRate.add(1);
}

function login(b) {
  const res = http.post(
    `${b}/v1/auth/login`,
    JSON.stringify({ email: "loadtest-lead@example.com", password: "TestPassword123!" }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(res, { "login 200": (r) => r.status === 200 }) || errorRate.add(1);
}

function unauth(b) {
  const res = http.get(`${b}/v1/tasks`);
  check(res, { "unauth 401": (r) => r.status === 401 }) || errorRate.add(1);
}

export function mixed() {
  const b = base();
  const r = Math.random();
  if (r < 0.4) {
    health(b);
  } else if (r < 0.7) {
    signupTasks(b);
  } else if (r < 0.9) {
    login(b);
  } else {
    unauth(b);
  }
}

export function healthOnly() {
  health(base());
  sleep(1);
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs?.values?.count || 0;
  const failed = (data.metrics.http_req_failed?.values?.rate || 0) * 100;
  const avg = data.metrics.http_req_duration?.values?.avg || 0;
  const p95 = data.metrics.http_req_duration?.values?.["p(95)"] || 0;
  const p99 = data.metrics.http_req_duration?.values?.["p(99)"] || 0;
  const signups = data.metrics.signups?.values?.count || 0;
  const dropped = data.metrics.dropped_iterations?.values?.count || 0;
  const failedChecks = data.metrics.errors?.values?.rate || 0;

  const lines = [
    "",
    "=================================================",
    "  MULTI-INSTANCE LOAD TEST (api x2) â€” PHASE 13 #13",
    "=================================================",
    `  Requests:        ${total}`,
    `  HTTP failed:     ${failed.toFixed(2)}%`,
    `  Check errors:    ${(failedChecks * 100).toFixed(2)}%`,
    `  Avg latency:     ${avg.toFixed(0)}ms`,
    `  P95 latency:     ${p95.toFixed(0)}ms`,
    `  P99 latency:     ${p99.toFixed(0)}ms`,
    `  Signups:         ${signups}`,
    `  Dropped iters:   ${dropped} (load-generator capacity)`,
    "=================================================",
    "",
  ];

  return {
    stdout: lines.join("\n"),
    "backend/load-tests/multi-instance-results.json": JSON.stringify(
      {
        kind: "multi-instance",
        instances: [I1, I2],
        totalRequests: total,
        httpFailedRate: failed / 100,
        checkErrorRate: failedChecks,
        avgLatencyMs: avg,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        signups,
        droppedIterations: dropped,
        thresholds: (() => {
          const out = {};
          for (const [name, m] of Object.entries(data.metrics || {})) {
            if (m && m.thresholds) out[name] = m.thresholds;
          }
          return out;
        })(),
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  };
}
