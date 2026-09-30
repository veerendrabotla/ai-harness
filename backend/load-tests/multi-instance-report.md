# Multi-Instance Local Load Test — PHASE 13 #13 (2026-10-01)

Definitive local proof that the API tier runs and degrades sanely on **two
replicas**, with a measured p95/error-budget report. Replaces the FINAL_GAP_AUDIT
Cat-2 entry "Multi-replica load test" (two-worker resilience was already proven
by `scripts/e2e-two-replica-socket.ts`; this covers HTTP tier behavior).

## Setup

| Piece | Value |
| --- | --- |
| Topology | `docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --scale api=2` → `api-1` :4000, `api-2` :4001, shared Postgres/Redis, nginx-free direct host ports |
| Scale override | `container_name: !reset null`, `ports: !override`, `RATE_LIMIT_*` raised to 100000 (limiter stays active, Redis-shared — 429s would be counted as failures) |
| Load tool | **k6 v2.3.0** (arrival-rate executors). `artillery@2.0.34` profile (`loadtest.yml` + `loadtest-processor.js`) kept for CI/Linux — on this Windows host artillery intermittently hard-crashes (`0xC0000409`, known Windows/Node stack-overflow fast-fail pattern; 3 runs, no JS stack) |
| Traffic split | 50/50 by VU parity (`__VU % 2` → absolute base URL), deterministic |
| Mix | 40% `GET /healthz` · 30% `POST /v1/auth/signup` + `GET /v1/tasks` (token) · 20% `POST /v1/auth/login` (seeded `loadtest-lead@example.com`) · 10% `GET /v1/tasks` unauthenticated (expected 401; `http.expectedStatuses` keeps it out of `http_req_failed`) |
| Phases (gate) | warm 10/s × 60s → **load 50/s × 120s** → cooldown health 15s (`sleep(1)` — see bug note) |
| Phases (probe) | warm 10/s × 60s → load 50/s × 120s → **spike 75/s × 60s** → cooldown 10s |
| Error budget | `p95 < 750ms`, `p99 < 2500ms`, failure rate < 1%, dropped iterations < 50 — derived from the *worst observed* steady state (spike-run load phase: server p95 459/558ms, p99 1493/1762ms) with ~35–40% headroom. k6 exits `99` on breach (CI-gate semantics); `exit 0` = budget met |
| Seed | one fixed account so login traffic doesn't inflate signup volume (initial storm of 409s from `$randomNumber` constant emails was fixed via `loadtest-processor.js` / unique-email generator) |

## 1. Gate run — definitive (committed profile)

`k6 run backend/load-tests/multi-instance.js` → **`K6_EXIT=0`, all 5 thresholds
`ok: true`** (2026-10-01 01:26:45–01:30:00 IST; artifact:
[`multi-instance-results.json`](./multi-instance-results.json)).

**Client-side (k6):** 8,632 requests · avg **58ms** · p95 **199ms** · p99 **320ms**
· HTTP failed **0.00%** · check errors **0.00%** · dropped iterations **0**
· 2,016 signups.

**Server-side (pino `responseTime`, both replicas):**

| Phase (50 rps window) | api-1 | api-2 |
| --- | --- | --- |
| warm (10/s) | n=385 avg 32.0 p95 **80.3** max 95.4 | n=406 avg 30.1 p95 **79.1** max 103.5 |
| load (50/s) | n=3982 avg 57.2 p50 19.4 **p95 200.6 p99 304.3** max 547.3 · >1s: **0** | n=3881 avg 58.1 p50 19.2 **p95 204.5 p99 337.1** max 563.2 · >1s: **0** |
| cooldown | 15 health reqs, p95 4.2 | 1, p95 2.1 |

**Replica distribution:** docker-log incoming deltas
`api1 24077→28464 (+4387)`, `api2 21965→26258 (+4293)` → **50.5% / 49.5%** —
balanced, both replicas serving the whole run (in-window counts 4382/4288).

**Budget consumption:** p95 199ms of 750ms (**27% used**, 3.8× headroom) ·
p99 320ms of 2500ms (**13% used**) · failures 0.00% of 1% (**0% used**).

## 2. Capacity probe (spike 75/s) — over-capacity evidence

Same stack, spike scenario enabled → **`K6_EXIT=99`** (threshold breach —
expected and desired: the probe exists to find the ceiling; 2026-10-01
01:13:53–01:18:09 IST).

**Client-side:** 15,805 requests · avg 768ms · **p95 4999.8ms** · HTTP failed
**0.00%** (queueing, not errors — nothing timed out at k6's 60s ceiling, no 5xx,
no 429).

**Server-side phases:**

| Phase | api-1 | api-2 |
| --- | --- | --- |
| warm (10/s) | p95 118 | p95 116 |
| load (50/s) | p95 **459** p99 1493 | p95 **558** p99 1762 |
| **spike (75/s)** | p50 **684** p95 **6328** p99 7161 · 1235/2796 >1s | p50 **857** p95 **7096** p99 7606 · 1261/2644 >1s |
| cooldown | backlog drained (p50 3465 → recovers) | backlog drained (p50 2.5 at tail) |

**Distribution:** 7310 / 8546 incoming (46% / 54%).

**Endpoint attribution (join `incoming`+`completed` by `reqId`, whole probe run):**

| Endpoint | api-1 p95 | api-2 p95 | Verdict |
| --- | --- | --- | --- |
| `/healthz` | 71 | 56 | flat — event loop stays responsive |
| `/v1/tasks` | 2350 | 2629 | inherits auth/DB queueing |
| `/v1/auth/login` | 4613 | 5103 | **argon2id verify + queue** |
| `/v1/auth/signup` | 6753 | 7308 | **argon2id hash (19 MB, t=2) + queue** |

## Findings

1. **Two-replica tier meets the design-load budget with large headroom**: at
   50 rps the worst instance p95 is ~205ms vs 750ms budget; zero requests above
   1s in the gate run; both replicas within 1% of each other.
2. **Capacity ceiling for the auth-heavy mix is between 50 and 75 rps** on this
   Docker Desktop tier: 50 rps sustains, 75 rps collapses into multi-second
   queueing (p50 already >680ms) and needs ~20s of drain. Argon2id dominates
   (~25 hashes/s combined signup+login at 50 rps). Provisioning rule of thumb:
   keep sustained auth traffic below ~2.5 hashes/s per vCPU, or add replicas.
3. **Failure mode is graceful**: latency degrades, error rate stays 0.00%
   (no 5xx / no 429 / no timeouts observed at 1.6×–2.1× capacity).
4. **Run-to-run variance is real** (steady p95 ranged 199–558ms depending on host
   state after Docker restarts) — this is why the budget is set from the *worst*
   observed steady state, not the best.
5. **Tooling decision**: k6 is the definitive load tool here; artillery crashed
   the host process intermittently (`0xC0000409`) after install and during runs.
   The artillery profile remains valid for Linux/CI.
6. **Test-harness bug found & fixed during this task**: the cooldown scenario
   (`constant-vus`, no `sleep`) hammered one replica at ~219/s for 15s
   (~3.3k stray requests, flattered p95). Fixed with `sleep(1)`; gate run 1 was
   discarded and re-run (gate run 2 above is the committed evidence).

## Reproduce

```bash
docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --scale api=2
# seed the fixed login account (409 = already seeded):
curl -X POST http://localhost:4000/v1/auth/signup -H "Content-Type: application/json" \
  -d '{"email":"loadtest-lead@example.com","password":"TestPassword123!","displayName":"Load Test Lead"}'
k6 run backend/load-tests/multi-instance.js        # exit 0 = budget met
docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --scale api=1  # restore
```

Artifacts: `multi-instance.js` (script), `multi-instance-results.json` (gate
run), `docker-compose.load.yml` (scale override), `loadtest.yml` +
`loadtest-processor.js` (artillery profile, CI/Linux).
