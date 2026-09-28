/**
 * API Load Test Suite.
 * Tests concurrent API operations and measures throughput/latency.
 * Run with: npx vitest run backend/apps/api/tests/load.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";

const API_BASE = process.env.API_URL ?? "http://localhost:4000";

interface RequestResult {
  status: number;
  latencyMs: number;
  error?: string;
}

async function makeRequest(path: string, options: http.RequestOptions = {}): Promise<RequestResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const url = new URL(path, API_BASE);
    const req = http.request(url, { ...options, timeout: 10000 }, (res) => {
      res.on("data", () => undefined);
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, latencyMs: Date.now() - start });
      });
    });
    req.on("error", (err) => {
      resolve({ status: 0, latencyMs: Date.now() - start, error: err.message });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, latencyMs: Date.now() - start, error: "timeout" });
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function concurrentRequests(
  path: string,
  count: number,
  options: http.RequestOptions = {},
): Promise<RequestResult[]> {
  const promises = Array.from({ length: count }, () => makeRequest(path, options));
  return Promise.all(promises);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function reportResults(label: string, results: RequestResult[]): void {
  const successes = results.filter((r) => r.status >= 200 && r.status < 500);
  const failures = results.filter((r) => r.status === 0 || r.status >= 500);
  const latencies = successes.map((r) => r.latencyMs).sort((a, b) => a - b);

  console.log(`\n--- ${label} ---`);
  console.log(`Total requests: ${results.length}`);
  console.log(`Successes: ${successes.length}, Failures: ${failures.length}`);
  if (latencies.length > 0) {
    console.log(`Latency (ms): p50=${percentile(latencies, 50)} p95=${percentile(latencies, 95)} p99=${percentile(latencies, 99)} max=${latencies[latencies.length - 1]}`);
  }
  if (failures.length > 0) {
    const errorSample = failures.slice(0, 3).map((f) => f.error ?? `HTTP ${f.status}`);
    console.log(`Error sample: ${errorSample.join(", ")}`);
  }
}

let serverAvailable = false;
// Probed at module load (collection time): describe.skipIf conditions are
// evaluated during collection, before beforeAll hooks would ever run.
try {
  const result = await makeRequest("/v1/health");
  serverAvailable = result.status === 200;
} catch {
  serverAvailable = false;
}

afterAll(() => {
  if (!serverAvailable) {
    console.log("\n⚠ Server not available at " + API_BASE + " — load tests skipped");
  }
});

describe("API Load Tests", () => {
  it.skipIf(!serverAvailable)("health endpoint handles 50 concurrent requests", async () => {
    const results = await concurrentRequests("/v1/health", 50);
    reportResults("Health Endpoint (50 concurrent)", results);
    const successRate = results.filter((r) => r.status === 200).length / results.length;
    expect(successRate).toBeGreaterThanOrEqual(0.95);
  });

  it.skipIf(!serverAvailable)("auth endpoint handles 20 concurrent login attempts", async () => {
    const body = JSON.stringify({ email: "loadtest@example.com", password: "testpass123" });
    const results = await concurrentRequests("/v1/auth/login", 20, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    reportResults("Auth Login (20 concurrent)", results);
    // All should return 401 (invalid credentials) not 500
    const non500 = results.filter((r) => r.status !== 500);
    expect(non500.length / results.length).toBeGreaterThanOrEqual(0.95);
  });

  it.skipIf(!serverAvailable)("providers endpoint handles 30 concurrent unauthenticated requests", async () => {
    const results = await concurrentRequests("/v1/providers", 30);
    reportResults("Providers Unauth (30 concurrent)", results);
    // 401 = unauthenticated (expected); 429 = rate-limited under parallel
    // test workers sharing one IP — both are correct protection behavior.
    const protected401Or429 = results.filter((r) => r.status === 401 || r.status === 429);
    expect(protected401Or429.length / results.length).toBeGreaterThanOrEqual(0.95);
  });

  it.skipIf(!serverAvailable)("mixed endpoint load - 100 total requests across endpoints", async () => {
    const endpoints = ["/v1/health", "/v1/health", "/v1/providers", "/v1/auth/login"];
    const requests: Promise<RequestResult>[] = [];

    for (let i = 0; i < 100; i++) {
      const path = endpoints[i % endpoints.length];
      if (path === "/v1/auth/login") {
        requests.push(makeRequest(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "load@example.com", password: "pass" }),
        }));
      } else {
        requests.push(makeRequest(path));
      }
    }

    const results = await Promise.all(requests);
    reportResults("Mixed Load (100 requests)", results);
    const successRate = results.filter((r) => r.status >= 200 && r.status < 500).length / results.length;
    expect(successRate).toBeGreaterThanOrEqual(0.90);
  });

  it.skipIf(!serverAvailable)("burst test - 200 rapid sequential requests", async () => {
    const results: RequestResult[] = [];
    const start = Date.now();
    for (let i = 0; i < 200; i++) {
      results.push(await makeRequest("/v1/health"));
    }
    const totalMs = Date.now() - start;
    reportResults(`Burst Sequential (200 requests in ${totalMs}ms)`, results);
    const successRate = results.filter((r) => r.status === 200).length / results.length;
    expect(successRate).toBeGreaterThanOrEqual(0.95);
  });
});
