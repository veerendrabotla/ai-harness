# Changelog

All notable changes to AI Harness are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

### Changed

### Fixed

---

## [0.1.0] — 2026-09-25

First public baseline of the platform: monorepo, control plane, agent runtime,
tool/permission stack, Local Bridge execution path, PWA frontend, and the
deployment tooling needed to run it. Summary below is derived from
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); anything not listed there
is not claimed here.

### Added

**Platform foundation**
- npm-workspaces monorepo: `frontend`, `backend/apps/*`, `backend/packages/*`, `desktop`, plus `local_bridge/`.
- Strict TypeScript across the backend (`npm run typecheck`), ESLint flat config with `no-explicit-any: error`, and Next.js lint config.
- Vitest unit suite covering the state machine, permission engine, tool harness, context engine, crypto/redaction/env validation and shared contracts; `npm test`.
- `docker-compose.yml` with Postgres 17.4 and Redis 7.4, healthchecks, shadow-DB init script and a one-shot `migrate` service.
- Categorized `.env.example` with fail-fast startup env validation.

**Authentication and authorization**
- Signup/login/logout with Argon2id (OWASP parameters).
- JWT access tokens (jose HS256, 15 min) plus rotating opaque refresh sessions (30 d) with reuse detection → session revocation.
- Password reset tokens (hashed, single-use, 30 min TTL); email delivery deferred to an operator-provided Resend key.
- Workspace membership and role checks (`OWNER` / `MEMBER` / `VIEWER`) on every workspace-scoped route.
- Rate limits per spec §7: IP-based login/signup/reset, user-based task creation, 120/min/user approval decisions.

**Workspaces and projects**
- Workspace CRUD, archive/restore, default policy creation and audit trail; member management with owner protections.
- Projects as cloud references or `LOCAL_BRIDGE` roots bound to registered, `CONNECTED` bridge roots.
- Immutable instruction versions (owner-only writes, audited) and policy read/update including tool-rule replacement.

**Providers and routing**
- Provider connections for Anthropic, OpenAI, Google, Ollama and OpenAI-compatible endpoints, stored AES-256-GCM-encrypted and never returned by any API.
- Live connection test at creation plus manual re-test; status `ACTIVE` / `ERROR`.
- Model routes per stage (`PLANNING`, `IMPLEMENTATION`, `REVIEW`) with priority, active flag, fallback-chain resolution and a cycle guard.

**Tasks and agent runtime**
- Full task lifecycle: `QUEUED → INITIALIZING → UNDERSTANDING → GATHERING_CONTEXT → PLANNING → WAITING_FOR_APPROVAL → EXECUTING → VERIFYING → COMPLETED`, plus `WAITING_FOR_TOOL_APPROVAL`, `OBSERVING`, `REPLANNING`, `REVIEWING`, `FAILED`, `CANCELLED` and `INTERRUPTED` paths, each transition validated against a centralized edge table and persisted as an event.
- Structured plan generation from real model calls (JSON extraction + zod validation + transient retry) with plan versioning (`DRAFT` / `APPROVED` / `REJECTED` / `SUPERSEDED`) and approve / reject / revise flows.
- Execution loop with hard bounds on duration, tool calls, model invocations and replans; cooperative cancel/pause flags checked between steps.
- Context engine with deterministic priority assembly, byte budgets, mandatory-item preservation, recorded omissions and secret redaction; a manifest is persisted per run.
- Ordered event publishing: persist-before-publish, Redis fan-out, and `afterSequence` client replay.
- Reviewer stage (`VERIFYING → REVIEWING → COMPLETED`) emitting advisory JSON findings as events, with an optional blocking gate (`lockOnReviewFindings`).
- Stuck-run recovery sweeper (orphaned runs → `INTERRUPTED`) and cross-process cancellation over a Redis control bus.

**Permissions and approvals**
- Permission Engine with exact/wildcard rules, `TASK`-scope approvals, `DENY` precedence, and `DESTRUCTIVE` never silently auto-approved; `.env*` writes escalate `ALLOW → ASK` unconditionally.
- Per-step permission gate during execution: `ALLOW` executes, `ASK` persists `WAITING_FOR_TOOL_APPROVAL` with an expiring approval, `DENY` records and replans (bounded).
- Cross-process resume reconciliation for approved-pending tool calls, unhandled denials and step cursors.

**Checkpoints and verification**
- Real git-backed pre-execution checkpoints executed through the Local Bridge, plus a confirmed, audited, event-streamed rollback endpoint (`POST /v1/checkpoints/:checkpointId/rollback`).
- Verification engine that records commands as `SKIPPED` with an explicit reason rather than reporting a fake pass.

**Tools, security and MCP**
- Tool registry with the V1 tool set (read/write/checkpoint/`mcp.call`/`http.request`) including schemas, risk levels, timeouts and output limits; harness-side schema validation, timeout enforcement, output truncation, failure classification and redaction.
- Security scanning package (`@ai-harness/security-scanner`) exposed through platform-admin routes.
- Prompt-injection defenses (fenced untrusted context, tag neutralization) with tests.
- MCP platform: registry CRUD with encrypted configs, discovery on enable, HTTP/SSE proxy through the permission gate, health sweeper marking failing servers `ERROR`, and STDIO transport executed through a connected bridge.

**Bridges, sandbox modes and desktop**
- Full Local Bridge pairing lifecycle, WebSocket bridge gateway (`:4010`, device-token auth, `CONNECTED → DEGRADED → DISCONNECTED` presence sweep with project auto-`UNAVAILABLE`) and a reference TypeScript agent performing real filesystem/terminal/git/checkpoint operations.
- Docker sandbox resolver (`SANDBOX_MODE=docker`, network-none, CPU/memory caps).
- Electron desktop scaffolding (`npm run desktop:dev` / `desktop:build*`).

**Frontend**
- Next.js 15 PWA (React 19, Tailwind 4, Radix, Zustand, TanStack Query, Serwist service worker) with installable webmanifest, app shell (rail / icon rail / drawer) and offline indicator.
- Task detail with activity, plan, approvals, verification, context and changes tabs plus approve / reject / revise / cancel / pause / resume / retry controls; providers, routing editor, bridges, MCP registry, instructions and policy settings.
- Auth store with memory-only access token, httpOnly refresh cookie, silent refresh and 401 retry; Socket.IO subscriptions with membership-checked rooms and polling fallback.

**SDK, CLI and observability**
- `@ai-harness/sdk` client and `@ai-harness/cli` package (see [SDK_GUIDE.md](SDK_GUIDE.md), [CLI_GUIDE.md](CLI_GUIDE.md)).
- pino JSON logging with redaction, request IDs on every response, audit logging for security-relevant actions, and the `requestId → taskId/runId → MODEL_INVOCATION_RECORDED → TOOL_* → outcome` trace chain.
- Prometheus `/metrics`, `/healthz`, aggregated `/v1/admin/health`, and the worker's `queue_depth` log line.

**Delivery**
- Four root Dockerfiles (`api`, `worker`, `gateway`, `frontend`) running esbuild bundles from `npm run build:backend` — production startup no longer requires `tsx`.
- GitHub Actions `ci.yml` (lint, typecheck, unit tests, builds, images) and `deploy.yml` (image push to Artifact Registry + Terraform apply behind manual `production` approval).
- Terraform GCP stack in `infra/terraform/`: Artifact Registry, Cloud SQL PostgreSQL 17 (regional HA, backups, deletion protection, private IP), Memorystore Redis 7.4 (Standard HA), Cloud Run services for api/worker/gateway and a runtime service account with `cloudsql.client`.
- Scripted verification: `npm run e2e:agent`, `e2e:smoke`, `e2e:bridge`, `e2e:resilience`, `bench:replay`, scenario benchmarks, and k6 / Artillery load profiles.

### Security

- Provider credentials and MCP configs encrypted with AES-256-GCM (`ENCRYPTION_KEY`) and excluded from every response payload.
- Secrets redacted from logs, event payloads, context packages and tool results; `SecretRegistry.maskOutput` masks registered values in tool output.
- An agent can never approve its own tool request; denied actions are never executed and required approvals are never bypassed.

### Known limitations (not in 0.1.0)

- Cloud Sandbox execution environment — `CLOUD_SANDBOX` tools return a structured unavailable result.
- Bridge Gateway is single-replica by design (in-memory sockets and pending calls).
- Email delivery for password reset/invites requires operator-supplied Resend credentials; Sentry SDK init and Stripe/SSO/GCS paths are env-plumbed but not fully wired.
- Diff viewer uses a custom unified renderer (Monaco swap-in pending); health checks are available at both `/healthz` and `/v1/health`.
- Remaining external-only setup is tracked in [EXTERNAL_DEPLOYMENT_CHECKLIST.md](EXTERNAL_DEPLOYMENT_CHECKLIST.md).
