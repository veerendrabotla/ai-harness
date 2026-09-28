# Troubleshooting

Diagnostics-first hub for AI Harness. Find your symptom, apply the fix, re-run the doctor commands from §1.

Related: [README](../README.md) · [API reference](API.md) · [contributing](../CONTRIBUTING.md) · [MCP guide](guides/mcp.md)

---

## 1. First: run the doctor commands

Run these before reading anything else. They are the same checks CI runs (`.github/workflows/ci.yml`).

```bash
npm run typecheck     # tsc -p tsconfig.check.json  — strict TS across backend workspaces
npm run lint          # eslint .                    — backend + root ESLint config
npm test              # vitest run                  — full unit suite
curl -sS http://localhost:4000/healthz
curl -sS http://localhost:4010/healthz          # bridge gateway
open  http://localhost:4000/docs                # Swagger UI (spec at /docs/json)
```

| Doctor | Healthy output | If it fails |
|---|---|---|
| `npm run typecheck` | no output, exit 0 | fix the reported `file:line` — CI blocks on it |
| `npm run lint` | no output, exit 0 | run `npx prettier --write .`, then re-read the ESLint rule |
| `npm test` | all green | jump to [§9 Test failures](#9-test-failures) |
| `/healthz` | `200` + `{"data":{"status":"ok","checks":{"database":"up"}}}` | jump to [§3 Database](#3-database-issues) |
| gateway `/healthz` | `200` + `{"status":"ok","connectedBridges":N}` | jump to [§6 Bridge](#6-bridge-issues) |

`/healthz` runs `SELECT 1` and returns **503** with `{"status":"degraded","checks":{"database":"down"}}` when Postgres is unreachable (`backend/apps/api/src/app.ts:192-202`). It is registered with `config: { rateLimit: false }`, so it never trips the limiter.

Other real scripts from root `package.json`: `npm run dev:api` (:4000) · `npm run dev:worker` · `npm run dev:frontend` (:3000) · `npm run lint:frontend` (the Next app is **not** covered by `npm run lint`).

---

## 2. Install & environment issues

### 2.1 Wrong Node version

**Symptom →** `npm install` warns `EBADENGINE`, or `npm run typecheck` fails on modern syntax. **Cause →** `package.json` declares `"engines": { "node": ">=22.14.0" }`; the project is developed on Node 24 LTS. **Fix →**

```bash
node --version        # must be >= v22.14
npm install           # installs all workspaces (frontend, backend/apps/*, backend/packages/*, desktop)
```

### 2.2 Missing `.env` / placeholder secrets

**Symptom →** the API exits during env validation, or crypto errors mention `JWT_ACCESS_SECRET` / `ENCRYPTION_KEY`. **Cause →** `.env` was copied from `.env.example` without regenerating the three `change-me-…` placeholders. **Fix →** run the **exact** command from `README.md` (it reads `.env.example`, substitutes fresh random secrets, and writes `.env` in one step):

```bash
node scripts/setup-env.mjs
```

> **Never regenerate `ENCRYPTION_KEY` after you have stored provider credentials or MCP server configs.** Those blobs are AES-256-GCM encrypted at rest; a new key makes existing rows undecryptable. See [§7.2](#72-credential--decryption-failures).

### 2.3 Skipped prerequisites before first start

**Symptom →** `Cannot find @prisma/client did you run prisma generate?`, or `P1001` / "Can't reach database server". **Cause →** README mandates an ordered first-run sequence; `db:generate` is explicitly marked **REQUIRED before first start**, and infra must be up first. **Fix →**

```bash
npm run infra:up       # starts postgres 17.4 + redis 7.4 containers
npm run db:generate    # generates the Prisma client (REQUIRED before first start)
npm run db:migrate     # applies Prisma migrations
```

### 2.4 `localhost` vs `127.0.0.1` — which host means what

**Symptom →** API/worker can't reach Postgres or Redis, or the browser can't reach the API, even though "everything is running". **Cause →** the hostname means a different thing depending on *where the process runs*:

| Where the process runs | Correct host | Evidence |
|---|---|---|
| On your machine (`npm run dev:*`) | `localhost` | `.env.example`: `…@localhost:5432`, `redis://…@localhost:6379`, `NEXT_PUBLIC_API_URL=http://localhost:4000` |
| Inside a Docker Compose service | the **compose service name** | `docker-compose.yml`: `@postgres:5432`, `redis://…@redis:6379`, gateway `API_URL: http://api:4000` |
| In the browser | `localhost` (never a compose service name) | `frontend/src/lib/api-client.ts` falls back to `http://localhost:4000` |

Inside a container, `localhost`/`127.0.0.1` resolves to **the container itself**, so `postgresql://…@localhost:5432` from inside the `api` container will never reach Postgres. **Fix →** keep host-run dev on `localhost` (as `.env.example` does) and let `docker-compose.yml` supply the service-host URLs — don't override them with `localhost`.

```bash
grep -E "DATABASE_URL|REDIS_URL|API_URL" .env docker-compose.yml
```

---

## 3. Database issues

### 3.1 Migration failures

**Symptom →** `npm run db:migrate` errors, or the API logs `P2021` (table does not exist) / `P3009` (migration already applied but failed) / `P3006` (shadow database unreachable). **Cause →** the Prisma client was never generated, migrations were never applied, or a migration previously failed halfway. **Fix →**

```bash
npm run infra:up
npm run db:generate
npm run db:migrate
# or the deploy path CI uses, if a migration is half-applied:
npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

Prisma needs a shadow database for `migrate dev`. Compose mounts `scripts/init-shadow-db.sql` to create `<db>_shadow`; a host-run Prisma uses the `SHADOW_DATABASE_URL` line already present in `.env.example`.

### 3.2 Cannot reach Postgres / Redis

**Symptom →** `/healthz` returns `503` with `"database":"down"`, or the API refuses to boot in production with `REDIS_URL must be reachable in production (Redis-backed rate limiting)` (`backend/apps/api/src/plugins/rate-limit.ts:31`). **Cause →** the containers aren't running, aren't healthy, or `.env` points at the wrong host (see [§2.4](#24-localhost-vs-127001--which-host-means-what)). **Fix →**

```bash
npm run infra:up
docker compose ps                  # postgres + redis must be healthy
docker compose logs postgres redis
curl -sS http://localhost:4000/healthz
```

Rate limiting falls back to in-memory when Redis is unreachable *in development only*; in production the API throws at startup instead.

### 3.3 Full database reset

**Symptom →** schema drift you can't repair, or you want a clean slate. **Cause →** data lives in the named Compose volumes `postgres-data` and `redis-data`. **Fix →** take the stack down, delete the volumes, and rebuild:

```bash
npm run infra:down           # docker compose down — stops containers, keeps named volumes
docker compose down -v       # ALSO removes the named volumes postgres-data / redis-data
npm run infra:up
npm run db:generate
npm run db:migrate
```

> ⚠️ `-v` destroys all workspaces, tasks, provider credentials and MCP server configs. `npm run infra:down` alone does **not** delete them — Docker Compose preserves named volumes unless `-v`/`--volumes` is passed (Docker Compose semantics, not repo-documented).

---

## 4. API issues

### 4.1 Port 4000 already in use

**Symptom →** `Error: listen EADDRINUSE: address already in use :::4000`. **Cause →** a previous `npm run dev:api`, or a Docker `api` container publishing `4000:4000`, still owns the port. **Fix →**

```bash
docker compose ps && docker compose stop api   # if a stale stack owns it
# otherwise move this instance off the default (env.ts default is 4000):
# .env
PORT=4010
```

Same pattern applies to the gateway (`BRIDGE_GATEWAY_PORT`, default `4010`) and the frontend (`3000`).

### 4.2 `429` / `RATE_LIMITED`

**Symptom →** responses come back `429 Too Many Requests` with `{"error":{"code":"RATE_LIMITED","message":"Too many requests. Please slow down."}}`. **Cause →** the global limiter is `RATE_LIMIT_GLOBAL_MAX` requests per minute (default **100**), keyed by user id (or by IP when unauthenticated) (`rate-limit.ts:35-43`); header names are lowercase (`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`). Auth routes override it — and `POST /v1/auth/login` is keyed by **IP** (`auth.routes.ts:72`) at `RATE_LIMIT_LOGIN_PER_15MIN`. **Fix →** wait for `x-ratelimit-reset`, or authenticate (the key becomes the user id instead of the IP). If you are behind a proxy, make sure the real client IP reaches Fastify or every user shares one bucket. Overrides live in `.env` (local dev values below are raised so parallel integration tests fit inside the buckets):

```bash
RATE_LIMIT_SIGNUP_PER_HOUR=100
RATE_LIMIT_LOGIN_PER_15MIN=500
RATE_LIMIT_RESET_PER_HOUR=5
RATE_LIMIT_GLOBAL_MAX=1000
```

### 4.3 `401 UNAUTHORIZED` on valid-looking requests

**Symptom →** `{"error":{"code":"UNAUTHORIZED","message":"Access token is invalid or expired"}}` or `"Authentication required"`. **Cause →** access tokens are short-lived: `ACCESS_TOKEN_TTL_SECONDS=900` (**15 minutes**), and `backend/apps/api/src/plugins/auth.ts:24-34` rejects anything missing/expired. **Fix →** refresh and retry — `POST /v1/auth/refresh` takes the refresh token as an **httpOnly cookie** or as `refreshToken` in the body (it does *not* read the `Authorization` header), and sessions last `REFRESH_SESSION_TTL_DAYS=30`:

```bash
curl -sS -X POST http://localhost:4000/v1/auth/refresh \
  -H 'content-type: application/json' \
  -d '{"refreshToken":"<refreshToken from the login response>"}'
# → { "data": { "accessToken": "…", "refreshToken": "…" } }
```

Also check, in order: the header is exactly `Authorization: Bearer <token>` (not `Token`); `JWT_ACCESS_SECRET` is identical across the API and worker (rotating `.env` invalidates all outstanding tokens); the token wasn't issued for a different `JWT_ISSUER`.

### 4.4 `409 CONFLICT` on delete

**Symptom →** e.g. `Disable this server in all workspaces before deleting it`, or `This connection is referenced by active model routes`. **Cause →** referential guards (`mcp.routes.ts:141-144`, `providers.routes.ts:205-210`). **Fix →** remove the dependency first (disable the workspace link / deactivate the model route), then retry.

### 4.5 Every response looks like an error

**Symptom →** you're parsing a body and getting `undefined` fields. **Cause →** success and failure use **different envelopes** (`docs/API.md`):

```json
{ "data": { }, "meta": { "requestId": "uuid" } }
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ] } }
```

**Fix →** branch on `error`, not on HTTP status alone. Error codes map to fixed statuses: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `RATE_LIMITED` 429 · `INTERNAL_ERROR` 500.

---

## 5. Worker / queue issues

### 5.1 Tasks stuck in `QUEUED` forever

**Symptom →** `GET /v1/tasks/:id` stays `QUEUED`; no `TaskRun` appears; the frontend shows no progress. **Cause →** the API crashed between creating the task and enqueuing the BullMQ job (the transactional-outbox gap), the worker isn't running, or Redis is down. **Fix →**

```bash
npm run dev:worker
grep -E "orphaned QUEUED task re-enqueued|stuck run marked INTERRUPTED" worker.log
```

The sweep cycle re-enqueues tasks `QUEUED` for more than **2 minutes** with no `TaskRun` and no waiting/active/delayed job, max 20 per cycle (`backend/apps/worker/src/worker.ts:317-345`).

### 5.2 Watch the queue depth

**Symptom →** you can't tell whether the worker is consuming at all. **Cause →** no signal. **Fix →** every sweep cycle emits a structured pino line; grep for it:

```json
{ "metric": "queue_depth", "waiting": 0, "active": 0, "completed": 12, "failed": 0 }
```

(`backend/apps/worker/src/worker.ts:391-403`, message `"queue stats"`) · `waiting` grows while `active` stays `0` → worker not consuming (not running, or `REDIS_URL` mismatch). `failed` grows → open the worker log for the job-level `worker error` entry.

### 5.3 Runs stuck / worker died mid-flight

**Symptom →** a run sits in a non-terminal state indefinitely, then abruptly reports `INTERRUPTED`. **Cause →** the stuck-run recovery sweeper marks runs older than **15 minutes** that aren't `COMPLETED`/`FAILED`/`CANCELLED`/`INTERRUPTED` as `INTERRUPTED` on both the run and the task, emitting `RUN_INTERRUPTED` with `reason: "WORKER_LOST"` (`worker.ts:347-374`). **Fix →** treat `WORKER_LOST` as recoverable — resume or retry the task, and check why the worker died:

```bash
npm run dev:worker 2>&1 | tee worker.log
grep -E "stuck run marked INTERRUPTED|stuck-run recovery sweep failed|worker error" worker.log
```

### 5.4 Approvals expiring instead of being decided

**Symptom →** tool calls flip to `DENIED` with an `APPROVAL_EXPIRED` event. **Cause →** the approval-expiry sweeper marks `PENDING` approvals past `expiresAt` as `EXPIRED` and flips their `WAITING_APPROVAL` tool calls to `DENIED` (`worker.ts:249-279`). **Fix →** watch for `TOOL_APPROVAL_REQUIRED` / `PLAN_APPROVAL_REQUIRED` and approve promptly via `POST /v1/approvals/:approvalId/approve`.

---

## 6. Bridge issues

There is no root-level `dev:gateway` script — the gateway is its own workspace: `npm -w @ai-harness/bridge-gateway run dev` (or the `gateway` service in `docker-compose.yml`). Its health probe is `curl http://localhost:4010/healthz`.

### 6.1 Pairing fails

**Symptom →** the local bridge agent can't pair; `POST /v1/bridges/pair` rejects the token. **Cause →** pairing is two-step and the token is single-use with a short TTL (`BRIDGE_PAIRING_TOKEN_TTL_MINUTES=15` default; `backend/apps/api/src/modules/bridges/bridges.routes.ts:19-94`): first you mint a token, then the *device* redeems it. **Fix →**

```bash
# 1. As the user (JWT-authenticated) — mint a token
curl -sS -X POST http://localhost:4000/v1/bridges/pairing-tokens \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'
# → 201 { "data": { "pairingToken": "…", "expiresInMinutes": 15 } }

# 2. On the device (pairing-token-authenticated, NOT JWT) — redeem it
curl -sS -X POST http://localhost:4000/v1/bridges/pair \
  -H 'content-type: application/json' \
  -d '{"pairingToken":"<raw token>","name":"my-laptop","version":"0.1.0"}'
# → { "deviceToken": "…" }   ← stored hashed; shown once
```

The token is deleted from Redis the moment it is redeemed — re-pairing requires minting a new one. If you lost the `deviceToken`, pair again.

### 6.2 Bridge shows `DEGRADED` or `DISCONNECTED`

**Symptom →** `GET /v1/bridges` reports `DEGRADED`, then `DISCONNECTED`; `LOCAL_BRIDGE` projects flip to `UNAVAILABLE`. **Cause →** the lifecycle is driven by the gateway (`backend/apps/bridge-gateway/src/server.ts`):

| Transition | Trigger |
|---|---|
| `PENDING` → `CONNECTED` | WS `hello` with matching `bridgeId` + `deviceToken` (`server.ts:34-62`) |
| `CONNECTED` → `DEGRADED` | the WS socket closes (`server.ts:64-79`) |
| `DEGRADED` → `DISCONNECTED` | presence sweeper every **30 s**: `lastSeenAt` older than **90 s** → `DISCONNECTED`, dependent `LOCAL_BRIDGE` projects → `UNAVAILABLE` (`server.ts:293-319`) |
| any → `REVOKED` | revoked by an admin; reconnect then closes with code `4403` |

**Fix →**

```bash
curl -sS http://localhost:4010/healthz    # {"status":"ok","connectedBridges":N}
grep -E "bridge connected|bridge disconnected|bridge marked DISCONNECTED" gateway.log
```

Then restart the bridge agent. Gateway auth failures close the socket with `4401 "authentication failed"` (bad token) or `4403 "bridge revoked"`.

### 6.3 Bridge is `CONNECTED` but calls still fail

**Symptom →** `Local Bridge is not connected` / `No connected bridge owns this project root`. **Cause →** the bridge is connected, but the **project root** isn't registered against it (`resolvers.ts:28-37` requires a `bridgeProjectRoot` row whose bridge is `CONNECTED`), or the worker can't reach the gateway. **Fix →**

```bash
# .env — worker → gateway must resolve
BRIDGE_GATEWAY_URL=http://localhost:4010
BRIDGE_INTERNAL_TOKEN=<same value as the gateway's>
```

`POST /execute` on the gateway returns `401 {"error":"unauthorized"}` when `x-internal-token` ≠ `BRIDGE_INTERNAL_TOKEN`, and `429` above 30 execute requests/minute per IP. The gateway is **single-replica by design** (in-memory socket map) — do not scale it horizontally (`server.ts:25-28`).

---

## 7. Model / provider issues

### 7.1 Provider saved but shows `ERROR`

**Symptom →** `POST /v1/providers` returns `201` with `test.ok: false`, and the row's `status` is `ERROR`. **Cause →** the API runs an **immediate health check** on create and flips the row on failure (`providers.routes.ts:71-106`); an unknown `providerType` fails even earlier with `No adapter for <type> in this build`. **Fix →**

```bash
# re-run the health check and read the detail message
curl -sS -X POST http://localhost:4000/v1/providers/$PROVIDER_ID/test \
  -H "Authorization: Bearer $TOKEN"
# → { "data": { "ok": true, "detail": "…", "latencyMs": 12 } }
```

Or `GET /v1/providers` (status is `ACTIVE` / `DISABLED` / `ERROR`) and `GET /v1/providers/:id/health`. Credentials are **never** returned — only `hasCredential: true|false`.

### 7.2 Credential / decryption failures

**Symptom →** `decrypt` errors, bad auth tag, or garbage strings when a provider or MCP server is used. **Cause →** `ENCRYPTION_KEY` must be a **base64-encoded 32-byte** value and must be byte-identical across API, worker and gateway for the lifetime of the data. Regenerating `.env` re-keys the process but not the stored ciphertext. **Fix →**

```bash
# .env — keep this stable after first use
ENCRYPTION_KEY=<base64 of exactly 32 bytes>
openssl rand -base64 32     # only for a BRAND NEW database
```

If you already have encrypted rows and lost the key, the credentials must be re-entered (recreate the provider connection / MCP server) — there is no recovery path.

### 7.3 Invalid API key / `PROVIDER_UNAVAILABLE`

**Symptom →** task fails with a provider error, or `No model provider is available for this stage`. **Cause →** the key is wrong/expired, no model route targets the stage, or no adapter exists for the requested provider type. **Fix →**

```bash
# 1. verify the connection
curl -sS -X POST http://localhost:4000/v1/providers/$ID/test -H "Authorization: Bearer $TOKEN"
# 2. verify a route exists for PLANNING / IMPLEMENTATION
curl -sS http://localhost:4000/v1/workspaces/$WS/model-routes -H "Authorization: Bearer $TOKEN"
```

Routes are replaced wholesale by `PUT /v1/workspaces/:workspaceId/model-routes` (`providers.routes.ts:247`) — a partial payload deletes the missing stages. The shape the E2E script sends:

```json
{ "routes": [ { "stage": "PLANNING", "providerConnectionId": "…", "modelIdentifier": "…", "priority": 10, "active": true } ] }
```

### 7.4 Ollama / local endpoint unreachable

**Symptom →** health detail `Ollama unreachable`, or connection refused on the provider test. **Cause →** Ollama isn't running, or the adapter is pointed at the wrong base URL. The native adapter (`backend/packages/model-adapters/src/ollama.ts`) reads `metadata.baseUrl`, documented as `http://localhost:11434`. **Fix →**

```bash
curl -sS http://localhost:11434/api/tags        # must list your models
```

Then point a provider at it — this is exactly the shape `scripts/e2e-agent-run.ts:71-79` uses (default `E2E_PROVIDER_BASE=http://localhost:11434/v1`):

```json
{ "providerType": "OPENAI_COMPATIBLE", "displayName": "Local Ollama",
  "credential": "not-required-locally",
  "metadata": { "baseUrl": "http://localhost:11434/v1" } }
```

(The native `OLLAMA` provider type works too.) Don't forget the model route — a healthy connection with no route still yields *no model available for this stage*.

---

## 8. Frontend issues

### 8.1 Browser can't reach the API

**Symptom →** the UI loads but every request fails, and the console shows requests going to the wrong host (e.g. `http://api:4000/...` inside a browser). **Cause →** the API base URL is resolved in this order (`frontend/src/lib/api-client.ts:8-11`): (1) runtime `window.__ENV__.API_URL` injected by `/env.js`, (2) build-time `process.env.NEXT_PUBLIC_API_URL`, (3) fallback `http://localhost:4000`.

`frontend/public/env.js` is a stub for local dev (`window.__ENV__ = window.__ENV__ || {}`); in Docker the entrypoint **rewrites it at container start** so the image never needs rebuilding (`Dockerfile.frontend` at the repo root, plus the `# NEXT_PUBLIC_API_URL is injected at RUNTIME via /env.js` comment in `docker-compose.yml`). **Fix →**

```bash
curl -sS http://localhost:3000/env.js          # 1. see what the browser received
# 2. set it for the running container (compose passes it to the entrypoint)
# docker-compose.yml / .env  — or frontend/.env.local for `npm run dev:frontend`
NEXT_PUBLIC_API_URL=http://localhost:4000
```

> Use `localhost`, never a Compose service name, for anything the **browser** resolves — see [§2.4](#24-localhost-vs-127001--which-host-means-what).

### 8.2 Frontend build fails

**Symptom →** `npm run build` (Next.js) errors. **Cause →** `npm run lint` only covers the backend; the Next app has its own script. **Fix →**

```bash
npm run lint:frontend
npm run build -w frontend     # same command CI's build job runs
```

---

## 9. Test failures

### 9.1 Docker-dependent tests skip or fail

**Symptom →** `docker-isolation.test.ts` reports skipped tests, or fails with `Docker not available`. **Cause →** `backend/packages/sandbox-engine/src/docker-isolation.test.ts` probes `engine.isDockerAvailable()` once and `return`s from every test when Docker isn't reachable; sandbox execution additionally requires `SANDBOX_MODE=docker`, which is the validated default (`env.ts`: `z.enum(["docker", ""]).default("docker")`). **Fix →**

```bash
docker info                 # must succeed
npm run infra:up
npm test
```

### 9.2 Integration tests fail without a database

**Symptom →** `races.integration.test.ts`, `session-portability.integration.test.ts`, or `backend/apps/api/tests/*` fail with connection errors. **Cause →** they require a live PostgreSQL — their headers say so (`require a live PostgreSQL (docker compose up)`). CI deliberately **excludes** the two `src/*.integration.test.ts` files from the unit job and runs `tests/acceptance.integration.test.ts` + `tests/multiplayer.integration.test.ts` separately with `continue-on-error: true`. **Fix →**

```bash
npm run infra:up
npx prisma migrate deploy --schema backend/prisma/schema.prisma
npm test                                                   # unit suite
npx vitest run backend/apps/api/tests/                     # integration suite
npx vitest run --exclude '**/races.integration.test.ts' \
  --exclude '**/session-portability.integration.test.ts'   # CI's exact unit command
```

### 9.3 Coverage threshold failures

**Symptom →** vitest exits non-zero on `ERROR: Coverage ... does not meet threshold`. **Cause →** `vitest.config.ts` enforces global thresholds of **60% statements, 50% branches, 60% functions, 60% lines**. **Fix →** add tests for the uncovered file; don't lower the threshold to pass CI. Single file: `npx vitest run backend/packages/permission-engine/src/evaluate.test.ts`.

### 9.4 E2E scripts need live services

**Symptom →** `npm run e2e:smoke` / `e2e:agent` / `e2e:bridge` hang or 404. **Cause →** they are scripts, not vitest suites — the API (and for `e2e:agent`, a reachable model provider) must already be running. **Fix →**

```bash
npm run dev:api                                # terminal 1
npx tsx scripts/smoke-vertical-slice.ts        # terminal 2 — API smoke suite
npm run e2e:smoke                              # same script via the package alias
npx tsx scripts/e2e-agent-run.ts               # full agent run vs a real provider
```

`npm run e2e:browser` builds the frontend first and needs Playwright browsers.

---

## 10. Getting help

### 10.1 What to include

Per `CONTRIBUTING.md` → *Reporting Issues*, open a GitHub Issue with steps to reproduce, expected vs actual behaviour, Node version + OS, and relevant logs (**redact secrets**). Also attach the output of `curl -sS http://localhost:4000/healthz | jq .`, `docker compose ps`, and `npm run typecheck 2>&1 | tail -20`.

### 10.2 Where the logs are

Everything logs structured **JSON via pino**; level comes from `LOG_LEVEL` (default `info`, `.env.example`).

| Process | Logger name | Notes |
|---|---|---|
| API | Fastify/pino | development runs `pino-pretty` with colouring (`backend/apps/api/src/app.ts:122-123`); production emits raw JSON on stdout |
| Worker | `ai-harness-worker` | `createLogger({ name: "ai-harness-worker", level: env.LOG_LEVEL })` |
| Gateway | `ai-harness-gateway` | bridge connect/disconnect + sweep events |
| MCP registry | `mcp-registry`, `mcp-stdio`, `mcp-connection-manager` | warnings/errors only (level `warn`) |

Capture and query them:

```bash
npm run dev:api > api.log 2>&1 ; npm run dev:worker > worker.log 2>&1
grep -E '"level":(40|50|60)' api.log            # warn / error / fatal
grep -E "queue_depth|stuck run marked INTERRUPTED|orphaned QUEUED" worker.log
grep -E "\[MCP\]|mcp server marked ERROR" api.log worker.log
```

`logs/` is git-ignored, so writing there is safe too. For what already happened, use the API instead of the logs: `GET /v1/admin/audit-logs` (platform audit trail), `GET /v1/tasks/:id/events?limit=500`, `GET /v1/approvals`. Every response carries `meta.requestId` — quote it when reporting a bug; it lines up with the API's pino entry for the same request.

### 10.3 Reference

- Endpoint inventory & error codes: [docs/API.md](API.md) · Install / run / test: [README.md](../README.md) · Pre-PR checklist: [CONTRIBUTING.md](../CONTRIBUTING.md)
- CI definition (what "green" means): `.github/workflows/ci.yml` · Honest per-subsystem status: [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md)
- MCP server problems: [docs/guides/mcp.md](guides/mcp.md)
