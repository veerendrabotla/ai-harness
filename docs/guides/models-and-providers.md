# Models and Providers

How AI Harness stores provider credentials, which providers exist, how a stage picks a
model, what happens on failure, and where spend shows up.

Primary references:

- [SECURITY.md](../../SECURITY.md) — credential storage rules
- [API.md](../API.md) — documented REST surface
- `backend/packages/model-adapters/src/registry.ts` — adapter registry
- `backend/packages/agent-runtime/src/model-router.ts` — routing and fallbacks
- `backend/packages/cost-tracker/src/cost-tracker.ts` — price tables / budget check

## Provider concept

A **provider connection** is a user-owned row in `provider_connections`
(`backend/prisma/schema.prisma:222-237`) with `providerType`, `displayName`,
`status`, `encryptedCredential` (bytes), and `encryptedMetadata` (bytes).

Storage rules ([SECURITY.md §Secret Management](../../SECURITY.md)):

- API keys are **encrypted with AES-256-GCM** and stored in `provider_connections`;
  they are never logged or exposed in API responses (`SECURITY.md:186-188`).
- They are **decrypted only at execution time** and passed directly to the adapter
  (`SECURITY.md:191-193`); the router performs decryption server-side
  (`backend/packages/agent-runtime/src/model-router.ts:240-258`).
- Rotation is supported: `ENCRYPTION_KEY` accepts a comma-separated key list — the
  first key encrypts, all keys are tried for decryption
  (`backend/packages/shared/src/env.ts:44-49`).

Implementation details:

- `encryptSecret` / `decryptSecret` in `backend/packages/shared/src/crypto.ts:31`
  produce `iv | tag | ciphertext`.
- `metadata` (for example `baseUrl`) is encrypted too — it is serialized to JSON and
  encrypted before insert (`backend/apps/api/src/modules/providers/providers.routes.ts:64-66`).
- The API serializer exposes only `hasCredential: Boolean(p.encryptedCredential)`
  (`providers.routes.ts:337`); the credential byte array never crosses the wire.
- Frontend copy matches: "Keys are encrypted with AES-256-GCM at rest and are never
  returned after saving" (`frontend/src/app/(app)/settings/providers/page.tsx:85`).

There are **no platform-level model API keys**. `.env.example:39-44` states that
provider keys are user-managed, submitted through the UI/API, and that
`PLATFORM_ANTHROPIC_API_KEY` / `PLATFORM_OPENAI_API_KEY` are reserved, commented-out
placeholders. `backend/packages/shared/src/env.ts` contains no provider API-key
variable at all — the only required secret related to providers is `ENCRYPTION_KEY`.

## Supported providers

The registry (`backend/packages/model-adapters/src/registry.ts:17-52`) registers six
provider types; `PROVIDER_TYPES` in `backend/packages/contracts/src/enums.ts:10-17`
matches the Prisma enum exactly:

| `ProviderType` | Adapter file | Notes |
|---|---|---|
| `ANTHROPIC` | `model-adapters/src/anthropic.ts` | Anthropic Messages API via SDK |
| `OPENAI` | `model-adapters/src/openai.ts` | OpenAI SDK |
| `GOOGLE` | `model-adapters/src/google.ts` | Gemini API |
| `OLLAMA` | `model-adapters/src/ollama.ts` | `ollama` SDK 0.5.14, local host via `metadata.baseUrl` |
| `OPENAI_COMPATIBLE` | `model-adapters/src/openai-compatible.ts` | native `fetch`; vLLM, LM Studio, Ollama `/v1`, OpenRouter |
| `TEST` | `model-adapters/src/test-adapter.ts` | deterministic scenarios (`fail-planning`, `fail-execution`, `fail-retryable`) for tests |

Two registries exist and are not identical:

- `ModelAdapterRegistry` (above) — `require(providerType)` throws
  `PROVIDER_UNAVAILABLE` for unknown types; used by the orchestrator and API health
  routes.
- `ModelRuntime` is constructed with **four** adapters — `ANTHROPIC`, `OPENAI`,
  `GOOGLE`, `OLLAMA` — plus `timeoutMs: 120_000` and `maxRetries: 2`
  (`backend/packages/agent-runtime/src/runtime.ts:77-86`).

Calling `ModelRuntime.generate` with an `OPENAI_COMPATIBLE` or `TEST` connection
therefore throws `No adapter registered for provider: …`
(`model-adapters/src/runtime.ts:49-51`); those types are served through the adapter
registry path. Verified claim: `DECISIONS.md:55` records the original deferral of the
Google/native-Ollama adapters, but both files now exist and are registered — treat the
registry above as current.

## Adding a provider

### REST endpoints (from [API.md](../API.md))

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/providers` | List provider connections |
| `POST` | `/v1/providers` | Add provider connection |
| `GET` | `/v1/providers/:id` | Get provider |
| `PATCH` | `/v1/providers/:id` | Update provider |
| `DELETE` | `/v1/providers/:id` | Delete provider |
| `GET` | `/v1/providers/:id/health` | Check provider health |

Two more exist in code but are **not** in `API.md`:

- `POST /v1/providers/:providerConnectionId/test` — re-run the adapter health check
  (`providers.routes.ts:108`)
- `GET /v1/providers/health/summary` — health across all connections
  (`backend/apps/api/src/modules/providers/provider-health.routes.ts:87`)

### `POST /v1/providers` body

```json
{
  "providerType": "ANTHROPIC",
  "displayName": "Work account",
  "credential": "sk-…",
  "metadata": { "baseUrl": "http://localhost:11434/v1" }
}
```

Validation comes from `createProviderRequestSchema`
(`backend/packages/contracts/src/providers.ts:37-42`) in addition to the Fastify JSON
schema (`providers.routes.ts:43-52`):

| Field | Rule |
|---|---|
| `providerType` | `providerTypeSchema` **excluding `OLLAMA` and `TEST`** — effectively `ANTHROPIC`, `OPENAI`, `GOOGLE`, `OPENAI_COMPATIBLE` (`providers.ts:35`) |
| `displayName` | 1–120 chars |
| `credential` | **8–4096 chars**, required |
| `metadata` | optional map of string values (for example `{ "baseUrl": "…" }`) |

The settings UI offers exactly the same four types
(`frontend/src/app/(app)/settings/providers/page.tsx:15`) and sends `metadata.baseUrl`
only for `OPENAI_COMPATIBLE` (`page.tsx:40`).

Additional behavior on insert:

- Credential and metadata are encrypted, status starts `ACTIVE`
  (`providers.routes.ts:57-69`).
- An immediate health check runs; failure flips `status` to `ERROR` but the response
  still contains only the serialized provider plus a `test` health result —
  never the credential (`providers.routes.ts:71-106`).
- A `providerType` that passes validation but has no adapter in this build flips the
  row to `ERROR` and returns `PROVIDER_UNAVAILABLE` (`providers.routes.ts:73-80`);
  unknown strings are rejected earlier by the zod schema as `VALIDATION_ERROR`.

**Consequence for local servers:** `OpenAICompatibleAdapter` tolerates an empty
credential (`openai-compatible.ts:14-15`), but the create endpoint will not accept a
credential shorter than 8 characters. The documented workaround in
[troubleshooting.md](../troubleshooting.md) is a placeholder value:

```json
{ "providerType": "OPENAI_COMPATIBLE", "displayName": "Local Ollama",
  "credential": "not-required-locally",
  "metadata": { "baseUrl": "http://localhost:11434/v1" } }
```

(`troubleshooting.md:333-335`). Note that `OLLAMA` is rejected by this schema even
though the adapter and registry support it; `TEST` is test-only by design.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | yes | base64 32-byte AES-256-GCM key (or comma-separated rotation list); min length 43 (`env.ts:47-49`) |
| `DATABASE_URL`, `REDIS_URL` | yes | connection rows and queue (`env.ts:26-30`) |
| `PORT` | no (default `4000`) | API port (`env.ts:17`) |

No `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or equivalent exists in `env.ts`. OAuth
variables (`GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, …) at `env.ts:72-77` are for user
sign-in, not model access.

## Model routing

### Stages

`MODEL_STAGES = ["PLANNING", "IMPLEMENTATION", "REVIEW"]`
(`backend/packages/contracts/src/enums.ts:18`), matching `AGENT_RUNTIME.md §9`.

### Routes

A `ModelRoute` row binds `workspaceId + stage` to `providerConnectionId`,
`modelIdentifier`, optional `fallbackRouteId`, `priority`, and `active`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/workspaces/:workspaceId/model-routes` | list, ordered by stage then priority (`providers.routes.ts:225`) |
| `PUT` | `/v1/workspaces/:workspaceId/model-routes` | **replaces** the whole route table; requires `OWNER` (`providers.routes.ts:247`) |

Both are implemented but **not listed in [API.md](../API.md)**. `PUT` validates that
every `fallbackRouteId` references a route inside the same payload, links each
referenced connection to the workspace, and rejects connections owned by another user
("Model routes may only reference your own provider connections",
`providers.routes.ts:263-293`).

### Decision order

`ModelRouter.resolve` documents the order (`model-router.ts:16-23`):

1. **Task manual override** — `overrideProviderConnectionId` / `overrideModelIdentifier`
   on the task; honored only when the connection is `ACTIVE`, owned by the caller, and
   linked to the workspace, otherwise a validation error
   (`model-router.ts:33-52`).
2. **Active workspace routes for the stage**, lowest `priority` number first.
3. **That route's configured fallback chain** — walked with a cycle guard
   (`visited` set); only configured fallbacks are used, never a silent substitute
   provider (`model-router.ts:76-100`).
4. Otherwise `PROVIDER_UNAVAILABLE`:
   `No active <stage> route is configured with a reachable provider`
   (`model-router.ts:103-105`).

Every hop also requires `providerConnection.status === "ACTIVE"` **and** a
`workspace_provider_connections` link (`model-router.ts:268-275`).

### `resolveWithFallbacks` — the chain the runtime actually uses

`resolveWithFallbacks` (`model-router.ts:108-231`) returns an **ordered array** of
decisions: the primary route first, then its fallbacks, de-duplicated by route id, and
stops after the first route with any viable candidate. Each `RouteDecision` carries
`providerConnection`, `modelIdentifier`, `routeId`, `usedFallback`, and `reason`.

Call sites and how the chain is consumed:

| Call site | Stage | Consumption |
|---|---|---|
| `planOnce` (`orchestrator.ts:420`) | `PLANNING` | `routes[0]` primary, `routes.slice(1)` passed as `fallbackRoutes` to `planner.createPlan` (`orchestrator.ts:426, 432`) |
| `proposeNextAction` (`orchestrator.ts:1058`) | `IMPLEMENTATION` | iterates the whole chain, one tool proposal per route; returns `null` (reasoning-only step) if no route resolves (`orchestrator.ts:1062-1068`) |
| Review stage (`orchestrator.ts:1144`) | `REVIEW`, falling back to `IMPLEMENTATION` if no review route (`orchestrator.ts:1149`) | iterates routes with a per-run review budget of 2 (`orchestrator.ts:1151-1154`) |
| Replan (`orchestrator.ts:1446`) | `IMPLEMENTATION` | `routes[0]` primary, `routes.slice(1)` as fallbacks (`orchestrator.ts:1450, 1455`); throws `PROVIDER_UNAVAILABLE` if none resolve |

### Retry behavior

Three cooperating layers:

1. **Adapter error classification.** `AdapterError.retryable`
   (`model-adapters/src/types.ts:56-66`) is set from HTTP status:
   - Anthropic/OpenAI: `status === 429 || status === 408 || status >= 500`
     (`anthropic.ts:15-16`, `openai.ts:15-16`)
   - OpenAI-compatible: `status === 429 || status >= 500` (`openai-compatible.ts:104,178`);
     unreachable endpoint is retryable, `NO_BASE_URL` is not
   - Google/Ollama provider failures are marked retryable; missing credential/base URL
     is not (`google.ts:18,77`, `ollama.ts:22,88`)
2. **Planner** (`backend/packages/agent-runtime/src/planner.ts:121-194`): iterates the
   candidate list (primary + fallbacks) with **two attempts per candidate**; a
   retryable error moves to the next fallback immediately, a non-retryable error breaks
   out entirely, and a schema validation failure retries once before moving on. Exhausting
   everything throws `PLAN_VALIDATION_FAILED`.
3. **`ModelRuntime.generate`** (`model-adapters/src/runtime.ts:58-91`): per-call
   timeout (120s as configured in `runtime.ts:84`) with `maxRetries: 2` and exponential
   backoff `min(1000 * 2 ** attempt, 10_000)` ms.

Fallback attempts are observable: `MODEL_ROUTE_SELECTED` is published with
`usedFallback: true` and `fallbackAttempt`, and `MODEL_INVOCATION_RECORDED` carries
`attempt`, `routeId`, `fallbackUsed` (`planner.ts:128-164`).

Run-level bounds are enforced separately by `assertBudget` before each planning
invocation (`orchestrator.ts:413`), per `AGENT_RUNTIME.md §6`: max wall-clock duration,
max model invocations, max tool calls, max replans, and provider budget if configured.

## Cost tracking

Three pricing/budget mechanisms exist; they are not the same code path.

### 1. `@ai-harness/cost-tracker` (in-process ledger)

`backend/packages/cost-tracker/src/cost-tracker.ts` ships price tables **per 1K
tokens**, for prompt and completion separately:

| Model | Prompt /1K | Completion /1K |
|---|---|---|
| `gpt-4o` | 0.0025 | 0.01 |
| `gpt-4o-mini` | 0.00015 | 0.0006 |
| `gpt-5` | 0.005 | 0.015 |
| `o3` | 0.01 | 0.04 |
| `claude-sonnet-4` | 0.003 | 0.015 |
| `claude-opus-4` | 0.015 | 0.075 |
| `claude-haiku-3-5` | 0.0008 | 0.004 |
| `gemini-2.5-pro` | 0.00125 | 0.005 |
| `gemini-2.5-flash` | 0.00015 | 0.0006 |
| `grok-3` | 0.003 | 0.015 |
| `deepseek-chat` | 0.00014 | 0.00028 |
| `mistral-large-latest` | 0.002 | 0.006 |

Unknown models fall through `resolvePrice` to tier heuristics — name containing
`haiku|mini|flash` → `0.001` prompt / `0.005` completion; `opus|gpt-4` → `0.015` /
`0.075`; otherwise `0.003` / `0.015` (`cost-tracker.ts:45-78`).

Budget enforcement API:

- `checkBudget()` → `{ withinBudget, currentSpend, budget }` against `config.monthlyBudget`
  for the current calendar month (`cost-tracker.ts:122-132`)
- `checkBudgetOrThrow()` → throws `Budget exceeded: spent <current> of <budget>`
  (`cost-tracker.ts:134-139`)
- `config.alertThreshold` defaults to `0.8` (`cost-tracker.ts:41`)

**Not wired:** no module outside this package imports `CostTracker` or calls
`checkBudgetOrThrow` (repo-wide grep). It is a usable library, not the enforcement
path described next.

### 2. Runtime estimator (writes `UsageRecord`)

`TaskOrchestrator.estimateCost` (`orchestrator.ts:2116-2137`) prices **per 1M tokens**:
`gpt-4o 2.50/10.00`, `gpt-4o-mini 0.15/0.60`, `gpt-4-turbo 10.00/30.00`,
`claude-3-5-sonnet-20241022 3.00/15.00`, `claude-3-opus-20240229 15.00/75.00`,
`gemini-1.5-pro 1.25/5.00`, `gemini-1.5-flash 0.075/0.30`; default `3.00/15.00`.
Each call appends a `usageRecord` row with tokens, cost, stage, and task id
(`orchestrator.ts:2091-2105`); a tracking failure only logs a warning and never fails
the run.

### 3. API estimator

`backend/apps/api/src/lib/usage-tracking.ts:28-51` keys prices as
`"<providerType>/<modelIdentifier>"` per 1M tokens (`openai/gpt-4o 2.5/10`,
`anthropic/claude-3.5-sonnet 3/15`, …) with default `2/8`, and writes the same
`UsageRecord` table.

### Budget enforcement (the real gate)

`backend/apps/api/src/lib/billing.ts`:

| Plan | `monthlyTokensLimit` | `monthlyCostLimit` | Price |
|---|---|---|---|
| `free` | 1,000,000 | $10 | $0 |
| `pro` | 10,000,000 | $100 | $49/mo |
| `enterprise` | 100,000,000 | $1,000 | $499/mo |

- Plan comes from the workspace's `ACTIVE`/`TRIALING` subscription, defaulting to `free`
  (`billing.ts:74-86`).
- Usage is aggregated from `usageRecord` for the current calendar month
  (`billing.ts:91-124`).
- `checkQuota(prisma, workspaceId, estimatedTokens, estimatedCost)` returns
  `allowed: false` with `Monthly token limit exceeded (used/limit)` or
  `Monthly cost limit exceeded ($used/$limit)` (`billing.ts:129-152`);
  `enforceQuota` throws `FORBIDDEN`.
- Actual call site: project/task creation checks a fixed estimate of **1000 tokens /
  $0.01** and returns **403** when over quota
  (`backend/apps/api/src/modules/builder/builder.routes.ts:133-136`).

### Where spend shows up

From [API.md](../API.md):

- `GET /v1/usage` — usage stats
- `GET /v1/workspaces/:id/cost-alerts` / `PUT /v1/workspaces/:id/cost-alerts` — cost
  alert config

Implemented in addition (`backend/apps/api/src/modules/usage/usage.routes.ts`):
`/v1/usage/by-model`, `/v1/usage/by-task`, `/v1/usage/trend`,
`/v1/usage/cost-summary` (plan, period, token/cost used, limit, percentage),
`/v1/usage/cost-breakdown`, `/v1/usage/cost-alerts`, `/v1/usage/analytics/daily`,
`/v1/usage/analytics/monthly`, `/v1/usage/anomalies`, `/v1/usage/quota`.

Cost alerts are also CRUD-able
(`backend/apps/api/src/modules/workspaces/workspaces.cost-alerts.ts`): `POST` with
`thresholdType: "COST" | "TOKENS"`, `thresholdValue`, `period`; `PUT /:alertId`;
`DELETE /:alertId`; and `POST /v1/cost-alerts/check` evaluates thresholds and emits
notifications.

## Local models

Two provider types target local/self-hosted servers:

| Provider | Requirement | Health check | Generation |
|---|---|---|---|
| `OLLAMA` | `metadata.baseUrl` (e.g. `http://localhost:11434`), else `NO_BASE_URL` (`ollama.ts:20-23`) | `ollama.list()` → "Ollama reachable (N models)" | `ollama.chat()` with the system instructions |
| `OPENAI_COMPATIBLE` | `metadata.baseUrl`; credential may be empty (`openai-compatible.ts:12-31`) | `GET {baseUrl}/models`, `AbortSignal.timeout(10_000)` | `POST {baseUrl}/chat/completions`, `AbortSignal.timeout(180_000)` |

`OpenAICompatibleAdapter` explicitly covers "vLLM, LM Studio, Ollama's `/v1`
endpoint, OpenRouter and similar servers" (`openai-compatible.ts:12-13`); both
generate and stream paths exist (`openai-compatible.ts:59, 167`).

Setup:

1. `POST /v1/providers` with `providerType: "OPENAI_COMPATIBLE"` (or `"OLLAMA"` if the
   create schema allows it in your build), a placeholder `credential` of at least 8
   characters, and `metadata: { "baseUrl": "http://localhost:11434/v1" }` — see
   [troubleshooting.md §Ollama](../troubleshooting.md).
2. Confirm with `GET /v1/providers/:id/health` or `POST /v1/providers/:id/test`.
3. Reference the connection from a workspace model route — a healthy connection with no
   route still yields *no model available for this stage*
   (`troubleshooting.md:338`).

`.env.example:39-44` reiterates that keys are user-managed and stored per-user in
`provider_connections`; nothing local needs to be configured server-side. One
operational constraint worth knowing: **never regenerate `ENCRYPTION_KEY` after
credentials exist** — existing rows become undecryptable and must be re-entered
(`troubleshooting.md:55, 303`).

## Rate limits and failure handling

**API rate limits** ([API.md](../API.md)): protected endpoints return
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and respond
`429 Too Many Requests` with code `RATE_LIMITED`. The Fastify error handler maps any
`statusCode === 429` to that code
(`backend/apps/api/src/plugins/error-handler.ts:38-44`), and the Redis-backed limiter
sets a `Retry-After` header before replying 429
(`backend/apps/api/src/lib/rate-limit.ts:142-145`). Auth-specific limits are env-tunable
(`RATE_LIMIT_SIGNUP_PER_HOUR`, `RATE_LIMIT_LOGIN_PER_15MIN`, `RATE_LIMIT_RESET_PER_HOUR`,
applied in `backend/apps/api/src/modules/auth/auth.routes.ts:33,72,157`). Workspace-level
config: `GET/PUT /v1/workspaces/:id/rate-limits` (`API.md`).

**Provider 429s** are handled as transient: adapters mark them retryable (see
[Retry behavior](#retry-behavior)), so the planner moves to the next fallback and
`ModelRuntime` retries with exponential backoff. The self-recovery classifier maps
messages containing `rate limit` or `429` to `MODEL_FAILURE`
(`backend/packages/self-recovery/src/recovery-engine.ts:34`).

**Provider health**: `GET /v1/providers/:id/health` and
`GET /v1/providers/health/summary` decrypt server-side and run the adapter health
check, returning ok/detail/latency only.

**Streaming/tool failures** and approval flows are covered in
[AGENT_RUNTIME.md §16](../AGENT_RUNTIME.md): retry transient model errors only while
retry budget remains; persist events before publication so clients can replay.

Not documented here because it could not be verified in source: OAuth sign-in timeout
values (GitHub/Google OAuth routes define no explicit timeout constant), and any
per-provider quota or `Retry-After` honored from upstream provider responses.
