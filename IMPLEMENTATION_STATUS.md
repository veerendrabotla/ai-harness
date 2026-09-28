# Implementation Status

Honest per-subsystem state after the initial foundation build.

Legend: ✅ COMPLETED · 🟡 PARTIALLY IMPLEMENTED · ⛔ NOT YET IMPLEMENTED

## Platform foundation
- ✅ Monorepo (npm workspaces): frontend, apps/api, apps/worker, 9 backend packages
- ✅ Strict TypeScript across backend; `tsc --noEmit` green
- ✅ ESLint flat config (backend incl. `no-explicit-any: error`) + Next config (frontend)
- ✅ Vitest configured; 56 tests green across 9 files
- ✅ docker-compose (postgres 17.4 + redis 7.4) with healthchecks + shadow DB
- ✅ `.env.example` fully categorized; startup env validation fails fast

## Authentication & authorization
- ✅ Signup/login/logout with Argon2id (OWASP params)
- ✅ JWT access tokens (jose HS256, 15 min) + rotating opaque refresh sessions (30 d)
- ✅ Refresh reuse detection → revoke all sessions
- ✅ Password reset tokens (hashed, single-use, 30 min TTL); email delivery deferred
- ✅ Membership + role checks on every workspace-scoped route (OWNER/MEMBER/VIEWER)
- ✅ Rate limits per BACKEND_STRUCTURE §7 (login/signup/reset IP-based; task creation user-based; approval decisions 120/min/user)

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
- ✅ MCP registry CRUD (encrypted configs) + discovery on enable + HTTP/SSE proxy through the permission gate; STDIO unsupported by design (D16).

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
- 🟡 Diff viewer renders unified diffs (custom renderer); Monaco swap-in pending
- 🟡 Toast system minimal; critical errors render inline (guideline-compliant)

## Observability
- ✅ Request IDs on every response; pino logging with redaction paths; sanitize helper for payloads
- ✅ Traceability: requestId → taskId/runId → MODEL_INVOCATION_RECORDED (provider/model/stage/usage/timestamps FR-016) → TOOL_* events → outcomes
- ✅ Audit log for security-relevant actions
- 🟡 Env plumbing for Sentry exists; SDK init pending (P3)

## Deployment
- 🟡 Dockerfiles (api/worker/gateway/frontend standalone) + GitHub Actions CI (typecheck/lint/unit/build/images). Terraform + deploy stages pending.

## Final completion pass (this revision)
- ✅ Prompt-injection defenses (fenced untrusted context, tag neutralization) with tests
- ✅ Cross-process cancellation of in-flight tool calls (Redis control bus → abort registry → CANCELLED classification) with test
- ✅ Stuck-run recovery sweeper (orphaned runs → INTERRUPTED, recoverable)
- ✅ Streaming deltas on planning AND replanning stages; planner unit tests (4)
- ✅ Production startup no longer requires tsx: esbuild bundles (`npm run build:backend`, `start:api/worker/gateway`); verified bundle serves healthz; all four Dockerfiles run bundles
- ✅ MCP STDIO discovery through bridge covered by E2E; worker STDIO executor uses the same protocol kind
- ✅ Scenario benchmark runner covering repo-understanding / multi-file / debugging / testing pipelines incl. approval gate
- 🟡 Remaining items are EXTERNAL ONLY — see EXTERNAL_DEPLOYMENT_CHECKLIST.md