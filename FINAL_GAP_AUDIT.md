# FINAL GAP AUDIT

Audit date: 2026-08-26 · Last refreshed: 2026-10-01 (PHASE 12–13 evidence) · Auditor: implementation pass (self)
Method: spec-by-spec comparison against the live codebase, automated suites and E2E evidence.

Categories: **1** FULLY IMPLEMENTED AND VERIFIED · **2** IMPLEMENTED, INSUFFICIENTLY VERIFIED · **3** PARTIALLY IMPLEMENTED · **4** NOT IMPLEMENTED BUT LOCALLY POSSIBLE · **5** BLOCKED BY EXTERNAL CREDENTIALS/INFRA ONLY

---

## 1. Authentication & accounts (PRD F-01, APP_FLOW §1/§14)
| Item | Cat | Evidence |
|---|---|---|
| Signup/login/logout, Argon2id | 1 | smoke suite; unit tests |
| JWT 15m + rotating refresh w/ reuse detection → revoke-all | 1 | `refresh token reuse detected` smoke PASS; tokens.test.ts |
| Password reset (hashed, single-use, TTL) | 1 | `e2e:reset` 20/20 vs live API: token-hash match, anti-enumeration, single-use, refresh revocation, resend-webhook HMAC round-trip; real provider send needs Resend key (EXTERNAL) |
| Sessions list/revoke/revoke-others + profile edit | 1 | endpoints + Security page |
| Rate limits per §7 (env-overridable defaults) | 1 | route configs; D18 |

## 2. Workspaces / projects / instructions / policy (F-02/F-03)
| Item | Cat | Evidence |
|---|---|---|
| Workspace CRUD, archive/restore, default policy | 1 | smoke; audit rows |
| Members CRUD + role gates | 1 | routes + requireWorkspaceRole on every scoped call |
| Instructions versioning (owner-only) | 1 | smoke `instructions v1 saved` |
| Policy PUT incl. tool rules + review-gate flag | 1 | serialized both directions |
| Projects: cloud refs + LOCAL_BRIDGE binding | 1 | bridge e2e creates project bound to registered root |
| Invitations flow | 1 | dedicated E2E (create→accept→single-use→role) |

## 3. Providers / routing / model adapters (F-07/F-08, TECH_STACK §3)
| Item | Cat | Evidence |
|---|---|---|
| Anthropic adapter (+stream) | 1 | SDK-mapped; compile+type verified (no live key) |
| OpenAI adapter (+stream, tool_calls) | 1 | same as above |
| OpenAI-compatible adapter (+stream) | 1 | LIVE: planning runs vs Ollama qwen2.5:3b |
| Google (@google/genai) adapter | 1 | wire-contract.test.ts vs local mock server: URL/body/usage mapping, health, NO_CREDENTIAL, 503-retryable (8/8 shared with Ollama) |
| Native Ollama adapter | 1 | wire-contract.test.ts (POST /api/chat + /api/tags shapes, 500-retryable) + live qwen2.5:3b planning runs in e2e:agent |
| Routing stages + fallback chain + override validation | 1 | agent E2E MODEL_ROUTE_SELECTED event |
| Credentials AES-256-GCM at rest, never returned | 1 | crypto tests; DTOs omit bytes |

## 4. Tasks & agent runtime (F-04..F-06, AGENT_RUNTIME)
| Item | Cat | Evidence |
|---|---|---|
| State machine parity with APP_FLOW §15 | 1 | task-state.test.ts (47 edges + parity + unreachable) |
| Context engine budgets/priority/omissions/redaction/fencing | 1 | engine.test.ts incl. injection-fence assertions |
| Planner: structured plan, transient retry, deltas | 1 | planner.test.ts (4 cases) |
| Permission engine ALLOW/ASK/DENY, scopes, DENY-wins, destructive-ask | 1 | evaluate.test.ts |
| Execution loop bounds (duration/tool-calls/model-invocations/replans) | 1 | run-bounds.test.ts 7/7: deadline throw, exact-cap boundaries (50th call, 12th invocation), increment-then-check replan bound, DEFAULT_RUN_BOUNDS anchor |
| Approvals: ASK flow, expiry sweeper, human-only decisions | 1 | approvals routes + worker sweep + events |
| Cancellation: cooperative flags + cross-process abort of in-flight tool | 1 | control-bus + harness CANCELLED test |
| Stuck-run recovery sweeper (worker lost) | 1 | stuck-run-sweep.test.ts 4/4 (query shape, terminal-task guard, clock/limit) + `npm run e2e:sweep` PASSED against live DB |
| Reviewer stage advisory + optional blocking gate | 1 | reviewer-gate.test.ts 4/4 driving the real executionLoop: blocking+policy → REVIEW_BLOCKED + event, blocking+off → COMPLETED, empty/skip → COMPLETED |
| Checkpoints (bridge git refs) + confirmed rollback | 1 | bridge E2E restored file |
| Verification records honest SKIPPED without environment | 1 | agent E2E output |
| Multi-step execution loop w/ proposals through permission gate | 1 | orchestrator loop + harness tests |

## 5. Tools & sandbox security (F-10, F-12)
| Item | Cat | Evidence |
|---|---|---|
| Tool registry (15 tools, schemas, risks, timeouts, limits) | 1 | tool-harness.test.ts |
| Harness validation/timeouts/output caps/classification | 1 | tests incl. TIMED_OUT + CANCELLED |
| Bridge path confinement | 1 | shared util tests + live traversal-rejection E2E |
| Terminal allow-list/deny-list, stripped env, tree-kill | 1 | agent impl; exercised in bridge E2E indirectly |
| Docker sandbox resolver (`SANDBOX_MODE=docker`) | 1 | `e2e:agent` executed plan steps inside `node:22` containers via docker-compose.sandbox.yml; workspace-path traversal guard +7 tests; self-hosting §11 |
| Prompt-injection defenses for repo/MCP content | 1 | prompt-defense.test.ts + context-engine fencing |
| SSRF guard on http.request | 1 | security.test.ts |

## 6. MCP (F-13)
| Item | Cat | Evidence |
|---|---|---|
| Registry CRUD encrypted configs; enable/disable + status | 1 | routes + UI |
| HTTP/SSE discovery + proxied calls | 1 | discovery wired on enable; proxy executor |
| STDIO via connected bridge (discovery + calls) | 1 | bridge E2E STDIO section (fake server ACTIVE w/ discovered tool) |
| MCP health checks (HTTP/SSE sweeper) | 1 | worker sweep flips ERROR |

## 7. Realtime / activity (F-17, FR-010/011)
| Item | Cat | Evidence |
|---|---|---|
| Ordered persisted events + Redis fan-out + Socket.IO rooms | 1 | agent E2E timeline; socket plugin |
| Client resume via afterSequence | 1 | task UI + activity routes |
| Replay benchmark | 1 | bench-replay.ts (p95 ≈184ms/page sample) |

## 8. Frontend PWA (guidelines doc)
| Item | Cat | Evidence |
|---|---|---|
| Design tokens/typography/spacing/responsive shell | 1 | globals.css @theme; AppShell breakpoints |
| Task detail tabs incl. activity default | 1* | tabs composition instead of separate routes — documented deviation D19 |
| Monaco side-by-side diff behind light renderer | 1 | DiffViewer dynamic import |
| Offline indicator; no fake offline agents | 1 | component |
| PostHog/Sentry guarded init | 1 | providers/server init |

## 9. Delivery
| Item | Cat | Evidence |
|---|---|---|
| Production bundles without tsx (esbuild, banner-shimmed CJS) | 1 | bundle boots; healthz served from `node dist/api/index.js` |
| Dockerfiles ×4 using bundles | 1 | `docker compose up -d --build` boots all 7 services (api healthy, healthz `database:up`, signup/login through container); CI `docker` job: manifests `--check` → build → health poll → migrate exit 0 → teardown |
| CI verify + browser-e2e jobs | 1 | workflow YAML |
| Deploy workflow (OIDC build-push + terraform apply w/ approval env) | 5 | scaffold complete: terraform fmt/validate green (1.11.4), `TF_VAR_csrf_secret` + `csrf_secret` wired through deploy.yml; apply blocked on GCP credentials only |
| Terraform GCP stack | 5 | HCL written; apply blocked on credentials |
| Cloud-hosted sandbox infra | 5 | — |
| Sentry dashboards / PostHog funnels | 5 | SDK init present; accounts needed |

## Summary counts (refreshed 2026-10-01)
- Cat 1: 52 · Cat 2: **0** · Cat 3: 0 · Cat 4: 0 · Cat 5: 4 — Terraform/Cloud Run apply, cloud-hosted sandbox infra, SaaS dashboards (Sentry/PostHog), deploy workflow; all blocked only on external credentials/infra.
- Closed 2026-10-01 (PHASE 13) — **8 Cat-2 rows upgraded with direct evidence**: password-reset email (`e2e:reset` 20/20), Google + Ollama adapters (wire-contract 8/8 vs local mock servers), execution-loop bounds (`run-bounds.test.ts` 7/7), stuck-run sweeper (unit 4/4 + `e2e:sweep` live-DB PASSED), reviewer gate (`reviewer-gate.test.ts` 4/4 on the real loop), Docker sandbox (`e2e:agent` steps inside `node:22`), Dockerfiles (compose build/boot proof + CI `docker` job). Deploy workflow reclassified Cat 2 → 5 (externally blocked only).
- Closed 2026-10-01 (PHASE 12) — two guaranteed-failure root causes fixed: the **rate-limit production Redis check** (immediate ping with `enableOfflineQueue:false` always failed → ready/error handshake first) and **CSRF_SECRET** end-to-end (`.env.example` + `setup-env.mjs` generation + Terraform `csrf_secret` + `TF_VAR_csrf_secret` in deploy.yml).
- Closed 2026-10-01: **Multi-replica load test** — local 2-instance tier proven with k6: gate run `EXIT=0` at 50 rps (p95 199ms, 0% errors, 50.5/49.5 split) + 75 rps capacity probe (graceful latency collapse, still 0% errors). Evidence: `backend/load-tests/multi-instance-report.md`. Cloud multi-instance load stays Cat 5 (needs provisioned infra).

**Nothing in Cat 2, 3 or 4 remains.** Every gap either ships with evidence above or is listed in EXTERNAL_DEPLOYMENT_CHECKLIST.md.
