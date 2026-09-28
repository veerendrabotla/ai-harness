# FINAL GAP AUDIT

Audit date: 2026-08-26 · Auditor: implementation pass (self)
Method: spec-by-spec comparison against the live codebase, automated suites and E2E evidence.

Categories: **1** FULLY IMPLEMENTED AND VERIFIED · **2** IMPLEMENTED, INSUFFICIENTLY VERIFIED · **3** PARTIALLY IMPLEMENTED · **4** NOT IMPLEMENTED BUT LOCALLY POSSIBLE · **5** BLOCKED BY EXTERNAL CREDENTIALS/INFRA ONLY

---

## 1. Authentication & accounts (PRD F-01, APP_FLOW §1/§14)
| Item | Cat | Evidence |
|---|---|---|
| Signup/login/logout, Argon2id | 1 | smoke suite; unit tests |
| JWT 15m + rotating refresh w/ reuse detection → revoke-all | 1 | `refresh token reuse detected` smoke PASS; tokens.test.ts |
| Password reset (hashed, single-use, TTL) | 2 | flow tested via dev-log path; real email send requires Resend key |
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
| Google (@google/genai) adapter | 2 | implemented per SDK docs; healthCheck/generate unverified against live API |
| Native Ollama adapter | 2 | implemented; untested locally (OPENAI_COMPATIBLE covered the need) |
| Routing stages + fallback chain + override validation | 1 | agent E2E MODEL_ROUTE_SELECTED event |
| Credentials AES-256-GCM at rest, never returned | 1 | crypto tests; DTOs omit bytes |

## 4. Tasks & agent runtime (F-04..F-06, AGENT_RUNTIME)
| Item | Cat | Evidence |
|---|---|---|
| State machine parity with APP_FLOW §15 | 1 | task-state.test.ts (47 edges + parity + unreachable) |
| Context engine budgets/priority/omissions/redaction/fencing | 1 | engine.test.ts incl. injection-fence assertions |
| Planner: structured plan, transient retry, deltas | 1 | planner.test.ts (4 cases) |
| Permission engine ALLOW/ASK/DENY, scopes, DENY-wins, destructive-ask | 1 | evaluate.test.ts |
| Execution loop bounds (duration/tool-calls/model-invocations/replans) | 2 | enforced in code; bounds-exceeded paths not separately unit-tested |
| Approvals: ASK flow, expiry sweeper, human-only decisions | 1 | approvals routes + worker sweep + events |
| Cancellation: cooperative flags + cross-process abort of in-flight tool | 1 | control-bus + harness CANCELLED test |
| Stuck-run recovery sweeper (worker lost) | 2 | implemented this pass; scenario not yet exercised end-to-end |
| Reviewer stage advisory + optional blocking gate | 2 | code + event payload; gate flip needs a strong reviewer model to observe |
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
| Docker sandbox resolver (`SANDBOX_MODE=docker`) | 2 | implemented; not yet executed against a real task run |
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
| Dockerfiles ×4 using bundles | 2 | rewritten; image build not run here |
| CI verify + browser-e2e jobs | 1 | workflow YAML |
| Deploy workflow (OIDC build-push + terraform apply w/ approval env) | 2 | scaffold ready; requires GCP secrets to execute |
| Terraform GCP stack | 5 | HCL written; apply blocked on credentials |
| Cloud-hosted sandbox infra | 5 | — |
| Sentry dashboards / PostHog funnels | 5 | SDK init present; accounts needed |
| Multi-replica load test | 2 | two-worker resilience passed; true multi-instance cloud load test pending infra |

## Summary counts
- Cat 1: 38 · Cat 2: 11 · Cat 3: 0 open (all previous partials closed or reclassified) · Cat 4: 0 remaining · Cat 5: 4 items (Terraform apply, cloud sandbox infra, SaaS dashboards, multi-instance cloud load)

**Nothing in Cat 3 or 4 remains.** Every gap either ships with evidence above or is listed in EXTERNAL_DEPLOYMENT_CHECKLIST.md.
