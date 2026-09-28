# Technical Decisions

Documented resolutions for spec conflicts and implementation choices made during the initial build. Each entry names the conflicting sources and the rule applied (prefer the more specific document; preserve architecture & security).

## D1 — `password_reset_tokens` table added
- **Conflict:** TECH_STACK auth section requires hashed single-use reset tokens (30 min TTL); BACKEND_STRUCTURE §2 schema has no table for them.
- **Decision:** Added `password_reset_tokens` (user FK, token_hash unique, expires_at, used_at). Consumption uses a guarded `updateMany` (single-use without a transaction).

## D2 — Task model-override persistence
- **Conflict:** `POST /v1/tasks` accepts `modelOverride {providerConnectionId, modelIdentifier}` (BACKEND_STRUCTURE §3 + AGENT_RUNTIME RunInput) but `tasks` table lacks columns.
- **Decision:** Added nullable `override_provider_connection_id` / `override_model_identifier`. Router honors override only when the connection is ACTIVE, owned by the task creator, and linked to the workspace.

## D3 — Plan rejection terminal state
- **Conflict:** APP_FLOW §15 has no FAILED edge from WAITING_FOR_APPROVAL, yet plan rejection must end execution.
- **Decision:** Rejection sets plan REJECTED and task CANCELLED (legal edge), with PLAN_REJECTED event + audit. Retry remains available.

## D4 — Retry resets task-level state to QUEUED
- **Conflict:** "A retry creates a new run" vs. state machine lacking FAILED→QUEUED edges (machine governs RUN lifecycle).
- **Decision:** Retry endpoint resets the *task mirror* to QUEUED directly (audited); a fresh run then follows the legal machine path. Documented exception, machine untouched.

## D5 — Pause/resume mapping
- **Conflict:** PRD F-06 requires pause/resume; no PAUSED state exists.
- **Decision:** pause = cooperative flag honored at step boundaries → INTERRUPTED (resumable); resume = INTERRUPTED→QUEUED + new run continuing from the APPROVED plan (skip planning).

## D6 — Node runtime version
- **Spec:** Node 22.14 LTS. **Machine:** 24.x LTS.
- **Decision:** Develop on installed 24; `engines.node >=22.14` documented. No API divergence.

## D7 — XState usage pattern
- **Issue:** XState v5's static `machine.transition(stringState, event)` is unreliable across 5.19–5.32 (crashes on seeded strings).
- **Decision:** The XState machine is generated **from** the single TRANSITIONS edge table; validation reads the machine's own config (`states[from].on[edge]`). Parity test asserts derived edges == APP_FLOW §15 edges exactly.

## D8 — Approval continuation ownership
- **Constraint:** No route handler may execute agent work; runtime lives in the worker.
- **Decision:** Approve/reject/revise endpoints persist decisions + audit, then enqueue BullMQ jobs (`resume-approved-plan`, `revise-plan`, `continue-after-tool-decision`). The orchestrator reconciles cross-process resumes via persisted events (approved-pending tool calls, unhandled denials, completed-step cursors).

## D9 — Honest environment failures
- **Rule:** Never fake success.
- **Decision:** Until Bridge/Sandbox exist: remote tools return structured `EXECUTION_ENVIRONMENT_UNAVAILABLE` (classified environment-related → replan budget → FAILED with code); verification commands record SKIPPED with reason; checkpoints record CHECKPOINT_SKIPPED. Nothing reports PASSED that never ran.

## D10 — Refresh token transport
- **Contract:** login/refresh return refreshToken in body (kept). **Security:** also set as httpOnly SameSite=Lax cookie scoped to `/v1/auth`; PWA keeps access tokens memory-only (Zustand) and silently refreshes on load/401. Reuse detection revokes all sessions.

## D11 — Rate limiting backend
- **Spec:** Redis-backed. **Offline dev:** Redis may be absent locally.
- **Decision:** Redis-backed when reachable; in-memory fallback in development only. Production startup fails if Redis is unreachable.

## D12 — Realtime fan-out channel
- **Decision:** All task events publish to Redis pub/sub after DB persistence; every API replica subscribes and emits to its local Socket.IO rooms (single-node included). Clients deduplicate/resume by sequence number.

## D13 — Package consumption style
- **Decision:** Workspace packages ship TS source directly (`main: src/index.ts`); apps run via `tsx`, Next transpiles via `transpilePackages` (+ webpack `extensionAlias` for NodeNext `.js` specifiers). Avoids dual build orchestration in phase 1; revisit compiled dists for containers next phase.

## D14 — Provider coverage in phase 1
- **Decision:** Anthropic + OpenAI adapters fully implemented per pinned SDK versions; OpenAI-compatible fetch adapter covers Ollama/LM Studio/vLLM today (verified live against Ollama `qwen2.5:3b`). Google/native-Ollama adapters deferred (registry raises structured PROVIDER_UNAVAILABLE — no silent substitutes).

## D15 � TypeScript reference Local Bridge (Go deferred)
- **Spec:** TECH_STACK pins Go 1.24.1 + gRPC for the Local Bridge.
- **Decision:** Shipped a protocol-compatible TypeScript reference agent (`local_bridge/`) plus the Node gateway so local execution works today. The gateway speaks JSON over WebSocket with an internal `/execute` API; a Go bridge can replace the agent without touching runtime/gateway code. Documented substitution.

## D16 � MCP transports in phase 2
- HTTP/SSE supported via JSON-RPC proxy (discovery on enable, calls through Tool Harness + Permission Engine). STDIO returns structured UNSUPPORTED � spawning processes inside the API is forbidden by BACKEND_STRUCTURE �7; STDIO will be bridged via the Local Bridge later.

## D17 � Reviewer is advisory
- PRD F-16 lists reviewer output as review-not-execution. The stage runs after verification, publishes its findings as events, and NEVER blocks COMPLETED. A future policy flag may opt workspaces into blocking reviews.

## D18 � Rate limits are env-overridable
- Spec values remain defaults (signup 5/h, login 10/15m, reset 5/h). Local dev/E2E override via RATE_LIMIT_* env vars; production keeps spec numbers.
