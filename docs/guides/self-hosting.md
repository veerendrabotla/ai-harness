# Self-Hosting AI Harness

A graduated deployment cookbook: **single-node dev box → production containers → GCP via Terraform**. Every command, service name, Dockerfile and environment variable below was read from this repository — nothing is illustrative.

Related reading: [README](../../README.md) · [External deployment checklist](../../EXTERNAL_DEPLOYMENT_CHECKLIST.md) · [Implementation status](../../IMPLEMENTATION_STATUS.md) · [MCP guide](./mcp.md) · [troubleshooting](../troubleshooting.md)

---

## 1. Topology

Four long-running Node processes, a one-shot migration container, and two infrastructure containers. Names below are the literal `container_name` / `build.dockerfile` values in [`docker-compose.yml`](../../docker-compose.yml).

| Service | Compose name | Image / Dockerfile | Port | Role |
|---|---|---|---|---|
| Postgres | `ai-harness-postgres` | `postgres:17.4` | `5432` | System of record (Prisma) |
| Redis | `ai-harness-redis` | `redis:7.4` | `6379` | BullMQ queue, rate limiting, Socket.IO pub/sub, control bus |
| Migrate | `ai-harness-migrate` | `Dockerfile.api` | — | One-shot `node scripts/migrate.mjs`, exits when done |
| API | `ai-harness-api` | `Dockerfile.api` | `4000` | Fastify 5 control plane (REST + Socket.IO + `/docs`) |
| Worker | `ai-harness-worker` | `Dockerfile.worker` | — | BullMQ consumer hosting the Agent Runtime |
| Bridge Gateway | `ai-harness-gateway` | `Dockerfile.gateway` | `4010` | WebSocket bridge for Local Bridge execution |
| Frontend | `ai-harness-frontend` | `Dockerfile.frontend` | `3000` | Next.js 15 PWA standalone server |

Dependency order is enforced in compose: `postgres`/`redis` healthy → `migrate` completes → `api`/`worker`/`gateway` start → `frontend` starts after `api` is healthy.

The fourth Dockerfile at the repo root, `Dockerfile.frontend`, is not part of the "three backend processes" below but is what `docker compose up --build` uses for the PWA.

---

## 2. Single-node quickstart

Prerequisites from the [README](../../README.md): Node ≥ 22.14, Docker with Compose, and one model endpoint (any OpenAI-compatible URL, or an Anthropic/OpenAI key).

```bash
npm install              # installs all workspaces
```

Generate secrets and create `.env` in one step:

```bash
node scripts/setup-env.mjs    # idempotent — use --force to rotate secrets
```

Then bring up the stack:

```bash
npm run infra:up         # postgres 17.4 + redis 7.4 containers
npm run db:generate      # generates the Prisma client — REQUIRED before first start
npm run db:migrate       # applies Prisma migrations
```

Three terminals:

```bash
npm run dev:api          # http://localhost:4000  (+ /docs for Swagger UI)
npm run dev:worker       # task-lifecycle queue consumer
npm run dev:frontend     # http://localhost:3000
```

There is no root `dev:gateway` script. Start the bridge gateway when you need Local Bridge execution or STDIO MCP:

```bash
npm -w @ai-harness/bridge-gateway run dev    # http://localhost:4010
```

Verification loop:

```bash
npm test                 # vitest suite
npm run typecheck        # tsc -p tsconfig.check.json
npm run lint             # eslint .
curl -s http://localhost:4000/healthz
npx tsx scripts/smoke-vertical-slice.ts      # API smoke suite, server must be up
```

---

## 3. Production containers

Production no longer needs `tsx`: `scripts/build-backend.mjs` (esbuild) bundles each app into a self-contained ESM file with heavy/native modules kept external.

```bash
npm ci --no-audit --no-fund
npm run build:backend     # writes dist/api/index.js, dist/worker/index.js, dist/gateway/index.js

npm run start:api         # node dist/api/index.js
npm run start:worker      # node dist/worker/index.js
npm run start:gateway     # node dist/gateway/index.js
```

The frontend is built separately (`npm run build` → `next build`); its Dockerfile does that internally.

### Dockerfiles at the repo root

| File | Build context | Runtime command |
|---|---|---|
| `Dockerfile.api` | `.` | `CMD ["node", "dist/api/index.js"]`, `EXPOSE 4000` |
| `Dockerfile.worker` | `.` | `CMD ["node", "dist/worker/index.js"]` |
| `Dockerfile.gateway` | `.` | `CMD ["node", "dist/gateway/index.js"]`, `EXPOSE 4010` |
| `Dockerfile.frontend` | `.` | `ENTRYPOINT ["/app/docker-entrypoint.sh"]`, `CMD ["node", "frontend/server.js"]`, `EXPOSE 3000` |

All four are multi-stage `node:22-alpine` builds that `npm ci` the workspace, run the bundler (`node scripts/build-backend.mjs <app>` — the same thing `npm run build:backend` does, or `npm run build -w frontend` for the PWA), and ship only the bundle plus production dependencies.

Whole-stack container run:

```bash
docker compose up -d --build
```

Compose injects `DATABASE_URL`, `REDIS_URL`, `NODE_ENV=production` and `SANDBOX_MODE` (default `docker`) into `api`/`worker`; the gateway additionally gets `API_URL=http://api:4000`. `NEXT_PUBLIC_API_URL` reaches the browser at **runtime** through `frontend/public/env.js`, so the build-time default (`http://localhost:4000`) only matters for local dev.

---

## 4. Environment variables

Source of truth: [`.env.example`](../../.env.example). Placeholders below are the literal template values — **never** put real secrets in this file or commit `.env`.

### 4.1 Secrets — generate, never commit

| Variable | Placeholder | Purpose |
|---|---|---|
| `JWT_ACCESS_SECRET` | `change-me-…` | Signs JWT access tokens (jose HS256) |
| `CSRF_SECRET` | `change-me-…` | HMAC key for CSRF double-submit cookies — **required in production**, boot fails without it |
| `ENCRYPTION_KEY` | `change-me-…==` | AES-256-GCM key for provider credentials + MCP configs |
| `BRIDGE_INTERNAL_TOKEN` | `change-me-…` | Shared secret between api/worker and the bridge gateway |

Generate all four at once with [`node scripts/setup-env.mjs`](#2-single-node-quickstart), or individually:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT_ACCESS_SECRET / CSRF_SECRET / BRIDGE_INTERNAL_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
```

Rotating `ENCRYPTION_KEY` invalidates every stored provider credential and MCP config; there is no re-encryption tool.

### 4.2 Application

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` in compose |
| `PORT` | `4000` | API port |
| `LOG_LEVEL` | `info` | pino level |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Comma-separated CORS allow-list |
| `API_BASE_URL` | `http://localhost:4000` | Public URL used in tokens/docs |

### 4.3 Database

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://ai_harness:ai_harness@localhost:5432/ai_harness?schema=public` | App pool |
| `SHADOW_DATABASE_URL` | `…@localhost:5432/ai_harness_shadow?schema=public` | Prisma Migrate shadow DB only |

Compose-level (read by `docker-compose.yml` only, with defaults `ai_harness` / `ai_harness_redis`): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`.

### 4.4 Redis / queue

| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | `redis://:ai_harness_redis@localhost:6379` | Queue + rate limit + pub/sub |
| `WORKER_CONCURRENCY` | `2` | BullMQ jobs in flight per worker process |

### 4.5 Auth / session

`JWT_ISSUER=ai-harness` · `ACCESS_TOKEN_TTL_SECONDS=900` · `REFRESH_SESSION_TTL_DAYS=30` · `PASSWORD_RESET_TTL_MINUTES=30` · `RATE_LIMIT_SIGNUP_PER_HOUR` (default `5`) · `RATE_LIMIT_LOGIN_PER_15MIN` (default `10`) · `RATE_LIMIT_RESET_PER_HOUR` (default `5`) · `RATE_LIMIT_GLOBAL_MAX` (default `100` per minute, keyed by user id or IP). The local `.env` raises these (`100` / `500` / `1000`) so parallel integration tests fit inside the buckets — keep production at the defaults or tune deliberately.

### 4.6 Model providers

**No platform-level model key is required.** Provider keys are user-managed: submitted through the UI/API, AES-256-GCM encrypted at rest, never returned by any endpoint. `PLATFORM_ANTHROPIC_API_KEY` and `PLATFORM_OPENAI_API_KEY` are commented out in `.env.example` and reserved for future server-side defaults.

### 4.7 Bridge

| Variable | Default | Notes |
|---|---|---|
| `BRIDGE_GATEWAY_PORT` | `4010` | Gateway listen port |
| `BRIDGE_GATEWAY_URL` | `http://localhost:4010` | What api/worker call (compose sets `http://gateway:4010`) |
| `BRIDGE_PAIRING_TOKEN_TTL_MINUTES` | `15` | Pairing link lifetime |
| `BRIDGE_SESSION_TOKEN_TTL_MINUTES` | `10` | Device session lifetime |

### 4.8 Sandbox, observability, frontend

- `SANDBOX_MODE` (unset by default; `docker` enables ephemeral container execution) · `SANDBOX_IMAGE=node:22-alpine`
- `SENTRY_DSN` (empty until you provide one)
- `NEXT_PUBLIC_API_URL=http://localhost:4000` (frontend; in containers it is injected at runtime via `env.js`)

### 4.9 Optional integrations (empty by default)

`GCS_BUCKET`, `GCS_PROJECT_ID` · `GITHUB_WEBHOOK_SECRET`, `GITLAB_WEBHOOK_SECRET`, `BITBUCKET_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET` (when unset, signature verification is skipped) · `OKTA_ISSUER_URL` · `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`

Env validation runs at startup and fails fast on a missing/invalid value.

---

## 5. Migrations

Two supported paths; both run the same Prisma migrations.

1. **Local / manual**

   ```bash
   npm run db:generate     # prisma generate
   npm run db:migrate      # via @ai-harness/database
   npm run db:studio       # optional Prisma Studio
   ```

2. **Container init** — the `migrate` service in `docker-compose.yml` runs `node scripts/migrate.mjs`, which executes `npx prisma migrate deploy --schema=backend/prisma/schema.prisma` and exits. `api`, `worker`, `gateway` and `frontend` all `depends_on: migrate: condition: service_completed_successfully`, so nothing starts against a stale schema.

`scripts/migrate.mjs` exits `0` with a warning if `DATABASE_URL` is unset, and `1` on a failed migration (which blocks dependent services from starting).

The shadow database is provisioned by `scripts/init-shadow-db.sql`, mounted as a Postgres init script.

---

## 6. Scaling

### API — scale horizontally

Task events fan out over Redis pub/sub, so a browser connected to replica A still receives events published by replica B (and by the worker). From `backend/apps/api/src/plugins/socket.ts`:

> *Worker-published events arrive over the Redis pub/sub channel, so fan-out works across API replicas; the in-process bridge covers local single-node dev.*

All room fan-out flows through the Redis channel — including a replica's own messages — so delivery is identical with one replica or many. Put a load balancer in front of `:4000` with sticky WebSockets (or rely on Socket.IO's reconnect + `afterSequence` replay, which is already implemented).

**Verified locally:** `npm run e2e:replicas` (`scripts/e2e-two-replica-socket.ts`) spawns a second API instance on `:4001`, connects one client to each replica plus a non-subscribed control client, publishes a worker-style event straight to Redis, and asserts both replicas deliver it to their local room while the control client receives nothing. The multiplayer gateway (`/multiplayer`) replicates the same way via its own `mp:broadcast` Redis channel (with an in-process fallback when Redis is down).

### Worker — scale horizontally

Safe. Two independent guarantees:

- **One active run per task**: `state-service.ts` counts active `taskRun` rows in the transaction that creates a run and throws `This task already has an active run` if one exists.
- **Idempotent enqueue**: jobs carry a `jobId` (`start:<taskId>`), so BullMQ rejects duplicates (`EJOBIDEXISTS` is treated as success), and the worker's stuck-run sweeper re-enqueues orphaned `QUEUED` tasks.

Tune `WORKER_CONCURRENCY` per process; add replicas freely.

### Bridge Gateway — **single replica (current limitation)**

`backend/apps/bridge-gateway/src/server.ts` states it directly: *"Gateway is single-replica by design (in-memory sockets + pending)"*. Live bridge connections and pending `POST /execute` calls are held in in-process `Map`s, and api/worker address it through one URL (`BRIDGE_GATEWAY_URL`). Run exactly one gateway instance; horizontal scaling would require moving that state to Redis or routing by `bridgeId`.

---

## 7. GCP with Terraform

`infra/terraform/` (Terraform ≥ 1.11.4, `hashicorp/google ~> 6.0`):

| File | Contents |
|---|---|
| `main.tf` | Artifact Registry repo `ai-harness` (DOCKER), Cloud SQL `ai-harness-pg` (`POSTGRES_17`, `REGIONAL`, deletion protection, backups on, `ipv4_enabled = false`), database `ai_harness` + user, Memorystore `ai-harness-redis` (`REDIS_7_4`, `STANDARD_HA`, 1 GB) |
| `cloudrun.tf` | Cloud Run services `ai-harness-api` (public `run.invoker`, 1 CPU / 512 Mi), `ai-harness-worker` (1 CPU / 512 Mi), `ai-harness-gateway` (1 CPU / 256 Mi); runtime service account `ai-harness-runtime` with `roles/cloudsql.client` |
| `variables.tf` | `project_id`, `region` (default `us-central1`), `db_tier` (`db-g1-small`), sensitive `db_password` / `jwt_access_secret` / `encryption_key` / `bridge_internal_token`, `frontend_origin`, `api_base_url`, `image_tag` |
| `outputs.tf` | `api_url`, `gateway_url`, `redis_host`, `db_private_ip` |

**Apply requires your GCP credentials** — the provider inherits Application Default Credentials. Authenticate first:

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
cd infra/terraform
terraform init
terraform apply \
  -var="project_id=<PROJECT_ID>" \
  -var="db_password=<…>" \
  -var="jwt_access_secret=<…>" \
  -var="encryption_key=<…>" \
  -var="bridge_internal_token=<…>"
```

For CI, prefer the repository's own path: `.github/workflows/deploy.yml` authenticates via workload identity federation (`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`), builds/pushes `api`/`worker`/`gateway` images to `${region}-docker.pkg.dev/${project}/ai-harness/<name>:<sha>`, then runs `terraform apply` behind the `production` environment's manual approval. Required GitHub secrets/variables are listed in the [deployment checklist](../../EXTERNAL_DEPLOYMENT_CHECKLIST.md) §4.

Frontend hosting is Vercel, not Cloud Run (root dir `frontend`, env `NEXT_PUBLIC_API_URL=<api_url>`); add the resulting domain to `FRONTEND_ORIGIN` on the API service.

---

## 8. Observability

| Signal | Where | Details |
|---|---|---|
| Liveness | `GET /healthz` | API: runs `SELECT 1`; `200 {status:"ok"}` / `503 {status:"degraded"}`. Gateway also serves `/healthz`. Rate-limit exempt. |
| Aggregated health | `GET /v1/admin/health` | Platform-admin JWT required. Database + Redis + worker checks, `503` when unhealthy. |
| Metrics | `GET /metrics` | Prometheus text (`text/plain; version=0.0.4`) from `@ai-harness/metrics-collector`, plus `process_resident_memory_bytes`, `process_heap_used_bytes`, `process_uptime_seconds`. Rate-limited to 30/min — scrape accordingly. |
| Logs | stdout | pino JSON with redaction paths; every response carries a request ID. Trace chain: `requestId → taskId/runId → MODEL_INVOCATION_RECORDED → TOOL_* → outcome`. |
| Queue depth | worker log line | Each sweep logs `{"metric":"queue_depth","waiting":…,"active":…,"completed":…,"failed":…}` with message `queue stats`. |
| Docs | `GET /docs` | Swagger UI |

Optional: set `SENTRY_DSN` on api+worker and `NEXT_PUBLIC_POSTHOG_KEY` on the frontend; both are env-guarded and inert when empty.

```bash
curl -s http://localhost:4000/healthz
curl -s http://localhost:4000/metrics | head -40
curl -s http://localhost:4000/metrics | grep -i queue
```

---

## 9. Backups

**Must back up:**

1. **Postgres data** — the `postgres-data` named volume (`docker compose down -v` deletes it). On GCP, Cloud SQL has `backup_configuration { enabled = true }` and `deletion_protection = true`.
2. **`.env`** — it holds `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY` and `BRIDGE_INTERNAL_TOKEN`. Losing `ENCRYPTION_KEY` makes every stored provider credential and MCP config permanently undecryptable; losing `JWT_ACCESS_SECRET` invalidates all access tokens (users re-login).
3. **Terraform state** — the state bucket created in checklist §2; it contains the same sensitive variables.

**Not required:** `redis-data` (queue, rate-limit windows, pub/sub — transient; losing it re-queues nothing that Postgres does not already know about).

**Restore drill:**

```bash
docker compose up -d postgres
pg_restore -U ai_harness -d ai_harness < backup.dump   # or copy the volume back
npm run db:migrate                                      # reconcile schema
docker compose up -d
curl -s http://localhost:4000/healthz
```

---

## 10. Known limitations

- **Bridge Gateway is single-replica** (§6) — plan capacity around one instance.
- **Cloud Sandbox execution is not implemented**; `CLOUD_SANDBOX` tools return a structured unavailable result. Local Docker sandboxing via `SANDBOX_MODE=docker` and Local Bridge execution are the working paths.
- **Health checks:** `GET /healthz` and `GET /v1/health` are aliases — both return `{ status, checks.database }` with 200/503.
- **Email delivery is deferred**: password-reset tokens are issued and hashed, but sending requires `RESEND_API_KEY` + `RESEND_FROM` (checklist §8).
- External-only remaining work is tracked in [EXTERNAL_DEPLOYMENT_CHECKLIST.md](../../EXTERNAL_DEPLOYMENT_CHECKLIST.md); subsystem-by-subsystem state is in [IMPLEMENTATION_STATUS.md](../../IMPLEMENTATION_STATUS.md).
