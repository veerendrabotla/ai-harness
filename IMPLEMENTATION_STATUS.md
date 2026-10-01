# Implementation Status

Honest per-subsystem state, updated through PHASE 13 (last refreshed 2026-10-01).

Legend: ✅ COMPLETED · 🟡 PARTIALLY IMPLEMENTED · ⛔ NOT YET IMPLEMENTED

## Platform foundation
- ✅ Monorepo (npm workspaces): frontend, apps/api, apps/worker, 9 backend packages
- ✅ Strict TypeScript across backend; `tsc --noEmit` green
- ✅ ESLint flat config (backend incl. `no-explicit-any: error`) + Next config (frontend)
- ✅ Vitest suite: 590 tests across 63 files green (unit + integration; `RUN_INTEGRATION=1` adds live-server suites)
- ✅ docker-compose (postgres 17.4 + redis 7.4) with healthchecks + shadow DB
- ✅ `.env.example` fully categorized; startup env validation fails fast

## Authentication & authorization
- ✅ Signup/login/logout with Argon2id (OWASP params)
- ✅ JWT access tokens (jose HS256, 15 min) + rotating opaque refresh sessions (30 d)
- ✅ Refresh reuse detection → revoke all sessions
- ✅ Password reset tokens (hashed, single-use, 30 min TTL); email delivery deferred
- ✅ Membership + role checks on every workspace-scoped route (OWNER/MEMBER/VIEWER)
- ✅ Rate limits per BACKEND_STRUCTURE §7 (login/signup/reset IP-based; task creation user-based; approval decisions 120/min/user); production Redis limiter awaits a ready/error handshake before ping (PHASE 12 fix); `RATE_LIMIT_GLOBAL_MAX` overridable

## Workspaces / projects
- ✅ Workspace CRUD + archive/restore + default policy creation + audit trail
- ✅ Members management (add/update/remove, owner protections)
- ✅ Projects: cloud references + LOCAL_BRIDGE roots bound to registered bridge roots with CONNECTED enforcement
- ✅ Instructions versioning (immutable versions, owner-only writes, audited)
- ✅ Policy read/update incl. tool rules replacement (audited)

## Providers & routing
- ✅ Provider connections (Anthropic/OpenAI/OpenAI-compatible) with AES-256-GCM storage; credentials never returned
- ✅ Live connection test at create + manual re-test; status ACTIVE/ERROR
- ✅ Model routes per stage with priority, active flag, fallback chain resolution, cycle guard
- ✅ Google (google/genai) + native Ollama adapters registered; streaming on Anthropic/OpenAI/compatible

## Tasks & Agent runtime
- ✅ Task creation with workspace/project/mode validation; MANUAL override validation; ROUTED requires a route
- ✅ Full lifecycle: QUEUED→INITIALIZING→UNDERSTANDING→GATHERING_CONTEXT→PLANNING→WAITING_FOR_APPROVAL→EXECUTING→VERIFYING→COMPLETED (+FAILED/CANCELLED/INTERRUPTED paths)
- ✅ Structured plan generation via real model calls (JSON extraction + zod validation + transient retry), plan versioning (DRAFT/APPROVED/REJECTED/SUPERSEDED)
- ✅ Approve/reject/revise flows (reject → CANCELLED per state machine; documented decision)
- ✅ Execution loop with bounds: max duration/tool calls/model invocations/replans; cooperative cancel/pause flags checked between steps
- ✅ Permission gate per step → ALLOW executes via harness; ASK persists WAITING_FOR_TOOL_APPROVAL + expiring approval; DENY records + replans (bounded)
- ✅ Cross-process resume reconciliation (approved-pending tool execution, unhandled denial detection, step cursor via events)
- ✅ Context engine: deterministic priority assembly, byte budgets, mandatory items preserved, omissions recorded, secrets redacted; manifest persisted per run
- ✅ Checkpoints: REAL git-backed pre-execution checkpoints via bridge + confirmed rollback endpoint (audited, event-streamed)
- ✅ Verification engine: commands recorded SKIPPED with explicit reason (no fake passes)
- ✅ Event publisher: ordered sequence allocation, persist-before-publish, Redis fan-out
- ✅ Reviewer stage: VERIFYING→REVIEWING→COMPLETED with advisory JSON findings as events (never blocks)
- ⛔ Cloud Sandbox execution environment

## Tools & permissions
- ✅ Registry with full V1 tool set (read/write/checkpoint/mcp/http) incl. schemas, risk levels, timeouts, output limits
- ✅ Permission Engine with exact/wildcard rules, TASK-scope approvals, DENY precedence, DESTRUCTIVE never silently auto-approved
- ✅ Harness: input schema validation, timeout enforcement (signal-independent), output truncation, failure classification, redaction
- 🟡 Executors: Local Bridge filesystem/terminal/git/checkpoint tools fully working via the gateway + reference agent (E2E verified); CLOUD_SANDBOX returns structured unavailable

## MCP
- ✅ MCP registry CRUD (encrypted configs) + discovery on enable + HTTP/SSE proxy through the permission gate; STDIO transport via a connected bridge (E2E: fake server ACTIVE with discovered tool).

## Bridges
- ✅ Full pairing lifecycle + WebSocket gateway (device-token auth, presence sweep DEGRADED→DISCONNECTED with project auto-UNAVAILABLE) + reference TS agent executing real tools. Go bridge swap-in documented in DECISIONS D15.

## Phase-2.5 additions
- ✅ Reviewer gating policy (lockOnReviewFindings) — blocking findings can fail runs; policy UI toggle live
- ✅ Invitations flow (schema, owner issue/revoke APIs + UI, single-use accept endpoint) — E2E verified
- ✅ Monaco DiffEditor swap-in behind the light renderer; PostHog/Sentry env-guarded init
- ✅ Docker sandbox resolver (SANDBOX_MODE=docker, network-none, cpu/mem capped)
- ✅ MCP STDIO transport via connected bridge; MODEL_TEXT_DELTA streaming events during planning

## Frontend
- ✅ Design system per FRONTEND_GUIDELINES (tokens, Inter/JetBrains Mono, spacing scale, WCAG-minded focus/reduced-motion)
- ✅ App shell (rail ≥1024px, icon rail tablet, drawer mobile) + offline indicator
- ✅ Pages: landing, login, signup, forgot/reset password, onboarding, dashboard, workspaces list/new/detail, project add, task create, tasks list, task detail (activity default tab + plan/approvals/verification/context/changes tabs, controls: approve/reject/revise/cancel/pause/resume/retry), providers, routing editor, bridges + pairing, mcp registry view, account settings, workspace settings (instructions + policy)
- ✅ PWA: Serwist service worker, webmanifest, icons, installable; honest offline behavior (no fake offline agents)
- ✅ Auth store: access token memory-only; refresh via httpOnly cookie; silent refresh + retry on 401
- ✅ Realtime: Socket.IO subscription w/ membership-checked rooms; polling fallback + afterSequence replay
- 🟡 Diff viewer: Monaco DiffEditor swapped in behind the light renderer
- 🟡 Toast system minimal; critical errors render inline (guideline-compliant)

## Observability
- ✅ Request IDs on every response; pino logging with redaction paths; sanitize helper for payloads
- ✅ Traceability: requestId → taskId/runId → MODEL_INVOCATION_RECORDED (provider/model/stage/usage/timestamps FR-016) → TOOL_* events → outcomes
- ✅ Audit log for security-relevant actions
- ✅ Monaco DiffEditor swap-in behind the light renderer; PostHog/Sentry env-guarded init (accounts external)

## Deployment
- ✅ Dockerfiles (api/worker/gateway/frontend) running esbuild bundles; first-run path proven (`docker compose up -d --build` → all 7 services healthy, healthz `database:up`, signup/login through the container)
- ✅ GitHub Actions CI: lint, typecheck, unit tests, builds, security, `docker` (manifests `--check` → compose build → health poll → migrate exit → teardown), `terraform` (fmt -check → init → validate)
- ✅ Terraform GCP stack validated (1.11.4 fmt/init/validate green; `csrf_secret` + `TF_VAR_csrf_secret` wired); GCP apply external-only (EXTERNAL_DEPLOYMENT_CHECKLIST)

## PHASE 12–13 additions (2026-10-01)
- ✅ Docker distribution path: `scripts/setup-env.mjs` one-command `.env` bootstrap, `env_file` + healthcheck wiring, 56 manifest COPY blocks regenerated (`gen-docker-manifests.mjs --check`), nested workspace `node_modules` seeded, `prisma generate` in images
- ✅ Fixed guaranteed failures: rate-limit production Redis false-negative (ready/error handshake), `CSRF_SECRET` end-to-end (env + setup-env + Terraform + deploy.yml), ESM `require` logger in auth-service, queue metrics reading a prefix that never existed
- ✅ Preview panel: remote previews stream through the Local Bridge (`POST /bridge/proxy`, HMAC proxy tickets, loopback-only guard, HTML/CSS subresource rewriting) — last code TODOs removed
- ✅ Verification-gap closures: execution-loop bounds (7/7), stuck-run sweeper (unit + `e2e:sweep`), reviewer gate (4/4 on the real loop), Google/Ollama wire contracts (8/8 vs mocks), password-reset email E2E (20/20), Docker sandbox real-task run (`e2e:agent` in `node:22`)
- ✅ Full E2E battery green: `e2e:smoke` 14/14, `e2e:agent` (Ollama), `e2e:bridge`, `e2e:resilience`, `e2e:replicas`, `e2e:browser` 37 passed — plus 6 root-cause fixes it flushed out (state-machine edge, planner rules, orchestrator fallback, middleware PUBLIC_ROUTES, lockfile platform entries, image pruning)
- ✅ Multi-instance local load test: k6 gate run `EXIT=0` at 50 rps, p95 199ms, 0% errors, 50.5/49.5 split (`backend/load-tests/multi-instance-report.md`); ceiling between 50 and 75 rps (argon2-bound)
- ✅ Worker hygiene: queue-job retention auto-clean + `queue_jobs` Prometheus/admin gauges incl. `failed`; fixed admin stats reading a never-existing queue prefix
- ✅ CLI/SDK contract fixes: `createTask` derives `workspaceId` (all CLI task/CI commands previously 400'd), `listTasks`, singular `revisePlan`, memory/rollback routes, event streaming paginates to terminal states, GitHub annotation format, envelope error messages — live-verified against the Docker stack + 14 new tests
- ✅ Docs coverage: PROMPT_GUIDE, MODELS_AND_PRICING, BENCHMARKS, RULES_AND_INSTRUCTIONS, USE_CASES, ENTERPRISE_SETUP new; getting-started 139→579; CLI/SDK/EXTENSION guides rewritten (476/558/470); CHANGELOG v0.1.0; llms.txt lists every doc

## Final completion pass (this revision)
- ✅ Prompt-injection defenses (fenced untrusted context, tag neutralization) with tests
- ✅ Cross-process cancellation of in-flight tool calls (Redis control bus → abort registry → CANCELLED classification) with test
- ✅ Stuck-run recovery sweeper (orphaned runs → INTERRUPTED, recoverable)
- ✅ Streaming deltas on planning AND replanning stages; planner unit tests (4)
- ✅ Production startup no longer requires tsx: esbuild bundles (`npm run build:backend`, `start:api/worker/gateway`); verified bundle serves healthz; all four Dockerfiles run bundles
- ✅ MCP STDIO discovery through bridge covered by E2E; worker STDIO executor uses the same protocol kind
- ✅ Scenario benchmark runner covering repo-understanding / multi-file / debugging / testing pipelines incl. approval gate
- 🟡 Remaining items are EXTERNAL ONLY — see EXTERNAL_DEPLOYMENT_CHECKLIST.md