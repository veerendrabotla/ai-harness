# Benchmarks

Reproducible, quantified performance numbers for the AI Harness platform —
the kind of page [Aider's leaderboards](https://aider.chat) made standard:
every claim below names the script that produced it, the machine it ran on,
and the date.

> **Scope, stated up front:** these are **platform** benchmarks — HTTP
> throughput, latency, event replay, suite health. They do **not** rank model
> coding quality; model-scenario results require external provider
> credentials and are published only when they exist (see
> [Scenario suite](#3-scenario-suite-model-quality) and the
> [leaderboard format](#leaderboard-format) reserved for them).

## Contents

- [Environment](#environment)
- [Methodology and glossary](#methodology-and-glossary)
- [1. HTTP load profile (k6 multi-instance)](#1-http-load-profile-k6-multi-instance)
- [2. Event replay (bench:replay)](#2-event-replay-benchreplay)
- [3. Scenario suite (model quality)](#3-scenario-suite-model-quality)
- [4. Regression suite (test floor)](#4-regression-suite-test-floor)
- [Leaderboard format](#leaderboard-format)
- [Reproducing these numbers](#reproducing-these-numbers)
- [Run log](#run-log)
- [FAQ](#faq)

## Environment

Every number on this page was produced on this host, in this configuration:

| Piece | Value |
|---|---|
| OS | Windows 11 Home Single Language |
| CPU | 11th Gen Intel Core i5-1135G7, 4 cores @ 2.40 GHz |
| RAM | 11.7 GB |
| Node / npm | v24.15.0 / 11.12.1 |
| Docker / Compose | 29.4.3 / v5.1.4 |
| Topology | API ×2 replicas + Postgres + Redis + worker (Docker), shared host |
| Load tool | k6 v2.3.0 (arrival-rate executors) |
| Run dates | 2026-09-30 → 2026-10-01 (IST) |

These are **local single-host numbers** — co-located DB/Redis, no CDN, no
autoscaling. They are a floor, not a cloud claim: production deployments
typically add headroom ([scaling notes](guides/self-hosting.md#6-scaling)).

## Methodology and glossary

**What gets benchmarked** (and why):

| Layer | Bench | Proves |
|---|---|---|
| HTTP tier | k6 multi-instance | Throughput/latency budget at design load; sane degradation beyond it |
| Read path | bench:replay | Event-sourcing replay stays flat as streams grow |
| Platform behavior | bench-scenarios | End-to-end task flow incl. approval gates (model-dependent) |
| Correctness floor | test suite | Nothing regressed while we optimized anything |

**Rules this page follows:**

1. Every number has a command next to it — if you cannot rerun it, it does
   not belong here.
2. **Gate runs and probes are different things.** A *gate* (exit `0`) proves
   a committed budget holds; a *probe* (expected exit `99`) deliberately
   overloads the system to find the ceiling. Both are reported; neither is
   allowed to masquerade as the other.
3. Client-side (k6) and server-side (pino `responseTime`) latencies are
   reported **separately** — they measure different hops and are not
   interchangeable.
4. Failed-but-not-errored work is visible: queueing that inflates latency
   without producing 5xx is called out as queueing, never hidden inside an
   "average".
5. One host, one date, one commit — runs are compared only like-for-like.

**Glossary:**

| Term | Meaning here |
|---|---|
| p95 / p99 | 95th/99th percentile latency — the slow tail, not the average |
| Arrival-rate executor | k6 schedules virtual users at a fixed requests/sec rate regardless of how slow responses get (models open-loop load; slower responses pile up, they do not self-throttle) |
| Dropped iteration | k6 could not start a scheduled iteration (system too saturated to even accept work) |
| Error budget | The committed p95/p99/failure ceiling the gate must not breach |
| >1s count | Requests whose server-side handling exceeded 1 second — the tail the averages hide |
| argon2id | Password hash (19 MB memory, t=2) — intentionally expensive; dominates signup/login cost |
| FR-011 | Feature request that mandates event replay as a first-class REST capability |

## 1. HTTP load profile (k6 multi-instance)

**Script:** [`backend/load-tests/multi-instance.js`](../backend/load-tests/multi-instance.js)
· **Full report:** [`backend/load-tests/multi-instance-report.md`](../backend/load-tests/multi-instance-report.md)

Two API replicas behind host ports, rate limiter active (limits raised so
limiter cost stays in the path without 429 noise). Traffic mix: 40%
`GET /healthz`, 30% signup+authenticated task list, 20% login, 10% expected
401s. Arrival-rate phases: warm 10 rps × 60s → **load 50 rps × 120s** →
cooldown.

**Committed error budget (the gate):** p95 < 750 ms · p99 < 2500 ms · HTTP
failures < 1% · dropped iterations < 50. k6 exits `0` when all thresholds
pass, `99` on breach.

### Budget derivation

The thresholds are not round numbers picked in advance — they were derived
from the *worst observed* steady state (the spike-run's 50 rps load phase:
server p95 459/558 ms, p99 1493/1762 ms) with ~35–40% headroom:

| Metric | Budget | Basis |
|---|---:|---|
| p95 | 750 ms | worst observed 558 ms × ~1.34 |
| p99 | 2,500 ms | worst observed 1762 ms × ~1.42 |
| HTTP failures | < 1% | floor: zero is achievable and observed |
| Dropped iterations | < 50 | ~0.6% of run volume |
| Check errors | < 1% | scenario-level success (signup/login flows) |

### Gate run (definitive, 2026-10-01 01:26–01:30 IST)

**Result: `K6_EXIT=0`, 5/5 thresholds ok.**

| Metric | Client (k6) |
|---|---:|
| Requests | 8,632 |
| Avg | 58 ms |
| **p95** | **199 ms** |
| **p99** | **320 ms** |
| HTTP failures | 0.00% |
| Dropped iterations | 0 |
| Signups created | 2,016 |

Server side (pino `responseTime`, load 50 rps window):

| Phase | api-1 | api-2 |
|---|---|---|
| warm (10 rps) | n=385, avg 32.0, p95 **80.3** | n=406, avg 30.1, p95 **79.1** |
| load (50 rps) | n=3982, p50 19.4, **p95 200.6**, p99 304.3, max 547.3, >1s: **0** | n=3881, p50 19.2, **p95 204.5**, p99 337.1, max 563.2, >1s: **0** |

Replica split **50.5% / 49.5%** (both replicas served the whole run). Budget
consumption at design load: **p95 uses 27%** of the 750 ms budget, p99 uses
13%, failures use 0%.

### Capacity probe (spike 75 rps, 2026-10-01 01:13–01:18 IST)

**Result: `K6_EXIT=99` — threshold breach is the point** (the probe exists to
find the ceiling).

| Metric | Value |
|---|---:|
| Requests | 15,805 |
| Client p95 | 4,999.8 ms |
| **HTTP failures** | **0.00%** (queueing, not errors — no 5xx, no 429, nothing timed out) |
| Spike phase p50 (api-1 / api-2) | 684 / 857 ms |
| Spike phase p95 | 6,328 / 7,096 ms |
| Distribution | 46% / 54% |

Endpoint attribution under spike (join of `incoming`+`completed` by `reqId`):

| Endpoint | api-1 p95 | api-2 p95 | Verdict |
|---|---:|---:|---|
| `/healthz` | 71 | 56 | flat — event loop stays responsive |
| `/v1/tasks` | 2,350 | 2,629 | inherits auth/DB queueing |
| `/v1/auth/login` | 4,613 | 5,103 | argon2id verify + queue |
| `/v1/auth/signup` | 6,753 | 7,308 | argon2id hash (19 MB, t=2) + queue |

**Findings:** sustainable ceiling for the auth-heavy mix is **between 50 and
75 rps** on this 4-core host; over-capacity manifests as graceful queueing
(zero errors, backlog drained in ~20s after the spike), and argon2id
password hashing is the dominant cost driver — not the event loop.

### Committed artifacts

| File | What it is |
|---|---|
| [`backend/load-tests/multi-instance.js`](../backend/load-tests/multi-instance.js) | The k6 scenario (phases, mix, thresholds, 50/50 VU-parity split) |
| [`backend/load-tests/multi-instance-results.json`](../backend/load-tests/multi-instance-results.json) | Raw gate-run output (thresholds, percentiles, per-metric summaries) |
| [`backend/load-tests/multi-instance-report.md`](../backend/load-tests/multi-instance-report.md) | Full write-up: server-side tables, distribution join, endpoint attribution |
| [`docker-compose.load.yml`](../docker-compose.load.yml) | Scale-2 override (`container_name: !reset null`, `ports: !override`, raised limits) |
| [`loadtest.yml`](../loadtest.yml) + [`loadtest-processor.js`](../loadtest-processor.js) | Alternate artillery profile (repo root) kept for CI/Linux (artillery hard-crashes intermittently on this Windows host: `0xC0000409`, 3 occurrences) |

## 2. Event replay (bench:replay)

**Script:** [`scripts/bench-replay.ts`](../scripts/bench-replay.ts) ·
**Command:** `npm run bench:replay`

FR-011's benchmark: sign up → workspace → project → dead-end provider → task
whose event stream is then replayed over REST in ≤200-event pages
(`GET /v1/tasks/:id/events?afterSequence=…`), measuring per-page latency.

Seven consecutive runs (2026-10-01, this host):

| Run | Pages | p50 | p95 | Total |
|---:|---:|---:|---:|---:|
| 1 | 1 | 23.4 ms | 23.4 ms | 45 ms |
| 2 | 1 | 57.3 ms | 57.3 ms | 87 ms |
| 3 | 1 | 17.4 ms | 17.4 ms | 35 ms |
| 4 | 2 | 24.6 ms | 70.2 ms | 114 ms |
| 5 | 1 | 19.0 ms | 19.0 ms | 37 ms |
| 6 | 1 | 17.3 ms | 17.3 ms | 33 ms |
| 7 | 4 | 21.5 ms | 21.6 ms | 100 ms |

**Summary:** median p50 **~21.5 ms** (range 17.3–57.3 ms), worst observed
p95 70.2 ms, whole-stream totals ≤ 114 ms — event replay is bounded by
network RTT, not by event count, at these stream depths.

**Honest caveats:** fresh-task streams are short (1–4 pages of 200); deep
streams (10k+ events on one task) have not been seeded yet, so long-tail
scaling is unmeasured — the follow-up is a seeding path in the same script.
The numeric CLI argument reserves a target event count but seeding is not
implemented; current results reflect whatever the failing-task lifecycle
emits.

## 3. Scenario suite (model quality)

**Script:** [`scripts/bench-scenarios.ts`](../scripts/bench-scenarios.ts)

Four PRD A7 repository-work scenarios, each creating a real task through the
API, driving human approval gates, and reporting duration + terminal state:

| Scenario | Exercises |
|---|---|
| `repo-understanding` | Read-only analysis of repo structure, entry points, test strategy |
| `multi-file-change` | Plan a cross-file feature (handler + test, ≥2 files) |
| `debugging` | Hypothesis tree for a redirect loop, verification plan |
| `testing` | ≥5 concrete rate-limiter test cases with boundaries |

```bash
# full stack + a reachable model route configured, then:
npx tsx scripts/bench-scenarios.ts http://localhost:4000
npx tsx scripts/bench-scenarios.ts http://localhost:4000 --only=debugging,testing
```

**Status: harness committed; no results published.** Model-dependent
benchmarks require provider credentials, which are external-only in this
repository (`.env` carries no model keys) and would make results
non-reproducible if committed. Published rows must satisfy the
[inclusion rules](#leaderboard-format) below; until then this section stays
empty rather than speculative.

## 4. Regression suite (test floor)

The cheapest, always-available benchmark — the test suite itself:

| Run | Files | Tests | Duration |
|---|---:|---:|---:|
| Default (`npm test`) | 61 (60 pass, 1 skip) | 576 (554 pass, 22 skipped) | 17.11 s |
| Full (`RUN_INTEGRATION=1 npm test`) | 61 | 576 + live-API suites | ~5 min |
| New in PHASE 13 #14 | 7 | 34 (queue hygiene + queue metrics) | — |

Plus `npm run typecheck` (0 errors) and `npm run lint` (0 errors) as gates on
every PHASE 13 task.

**Operational note:** the full run's live-API suites sign up accounts, so
heavy load runs can exhaust the signup rate-limit bucket (`ah-rl:*`,
100/hr/IP, Redis-backed) and cascade into 401s in unrelated suites. Flush
after load testing:

```bash
docker exec ai-harness-redis redis-cli -a ai_harness_redis --no-auth-warning \
  EVAL "local ks=redis.call('KEYS','ah-rl:*'); for i,k in ipairs(ks) do redis.call('DEL',k) end; return #ks" 0
```

## Leaderboard format

Reserved for scenario/model results. Inclusion rules:

1. **Same harness** as `scripts/bench-scenarios.ts` — no ad-hoc runs.
2. **≥3 runs per cell** — publish median + range, never a single sample.
3. **Record the full context:** model id + provider, commit sha, date,
   machine (reuse the [environment table](#environment)).
4. **Raw artifacts linked** (JSON output next to the report), like
   [`multi-instance-results.json`](../backend/load-tests/multi-instance-results.json)
   for load.
5. **Failures are results** — publish failed scenarios; never filter to
   green.

Template (empty until rule 1–5 are satisfiable here):

| Model | Scenario | Pass (median of ≥3) | Duration | Cost/task | Date | Commit |
|---|---|---:|---:|---:|---|---|
| _pending external model credentials_ | | | | | | |

## Reproducing these numbers

```bash
# 0. stack up
docker compose up -d --build

# 1. load profile (2 replicas + raised limits; k6 v2.3.0 on PATH)
docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --scale api=2
k6 run backend/load-tests/multi-instance.js            # exit 0 = budget met

# 2. event replay (stack on :4000)
npm run bench:replay

# 3. scenario suite (needs a reachable model route)
npx tsx scripts/bench-scenarios.ts http://localhost:4000

# 4. regression floor
npm test && npm run typecheck && npm run lint

# 5. restore base stack + flush rate limits used by the run
docker compose -f docker-compose.yml -f docker-compose.load.yml down
docker compose up -d --build
```

Numbers are host-dependent: compare runs only against runs on comparable
hardware, and always record the machine.

## Run log

| Date (IST) | Benchmark | Headline | Commit |
|---|---|---|---|
| 2026-10-01 | k6 gate (50 rps, ×2 replicas) | p95 199 ms / p99 320 ms, 0.00% failed, **5/5 thresholds** | `436b03f` |
| 2026-10-01 | k6 capacity probe (75 rps spike) | ceiling 50–75 rps, 0.00% errors while collapsing | `436b03f` |
| 2026-10-01 | bench:replay ×7 | median p50 ~21.5 ms, totals ≤114 ms | `cebb358` |
| 2026-10-01 | regression floor | 554/576 tests + typecheck 0 + lint 0 | `cebb358` |
| — | bench-scenarios (model quality) | awaiting external credentials | — |

## FAQ

**Why not benchmark model coding quality here?**
Because it requires external provider credentials this repository
deliberately does not carry, and because a number produced against one
provider's live API is not reproducible six months later. The
[leaderboard format](#leaderboard-format) defines how results enter this
page once they can be reproduced honestly.

**Why k6 and not artillery?**
Artillery `2.0.34` intermittently hard-crashes on this Windows host with
`0xC0000409` (a Windows/Node stack-overflow fast-fail pattern — three
occurrences, no JavaScript stack trace). k6 is a single native binary with
CI-gate semantics (`0` = thresholds met, `99` = breach). The artillery
profile remains committed for Linux CI where it runs reliably.

**Why raise the rate limits for the load run?**
The limiter stays *active* (its Redis-backed evaluation is part of the cost
being measured) but the numeric ceilings are raised so quota 429s are not
miscounted as system failures. A run with default limits would measure the
limiter, not the API.

**A p95 of 199 ms — is that slow?**
For a local Docker stack doing argon2id-bound signup/login traffic at 50
rps, it is 27% of the committed budget with zero >1s requests. Cross-host
comparisons are meaningless; compare against this machine's own budget and
history.

**Why publish a run that exits 99?**
Because the capacity probe's job is to find the ceiling. Exit `99` with
0.00% HTTP failures documents *where* saturation begins — the honest
complement to the gate's exit `0`.

**What does "0.00% failed while collapsing" mean?**
Under the 75 rps spike, every request eventually succeeded — but the tail
(p95 ≈ 5 s) says the system was queue-bound. Latency degradation without
errors is the platform's designed failure mode: shed time, not requests.

**How do I compare my machine's numbers to these?**
Run the same commands (see [Reproducing](#reproducing-these-numbers)), then
compare budget *utilization percentages* (p95 vs 750 ms), not raw
milliseconds across different hardware.

---

Related: [Load report](../backend/load-tests/multi-instance-report.md) ·
[Models and Pricing](MODELS_AND_PRICING.md) ·
[Self-Hosting](guides/self-hosting.md) ·
[Documentation benchmark](DOCUMENTATION_BENCHMARK.md)
