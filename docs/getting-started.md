# Getting Started

Get AI Harness running locally and complete your first agent task in under 30 minutes.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 22.14 (developed on 24 LTS) |
| Docker | with Compose (Postgres 17.4 + Redis 7.4) |
| A model endpoint | an Anthropic/OpenAI key, or any OpenAI-compatible URL (Ollama, LM Studio, vLLM) |

---

## Quick start with Docker (teams)

The fastest way to hand the platform to someone: **everything runs in containers** — API, worker, bridge gateway, web app, Postgres, Redis — with no local Node toolchain required to run (Node is only used once to generate secrets).

```bash
git clone <your-repo-url> ai-harness
cd ai-harness

node scripts/setup-env.mjs      # creates .env with fresh random secrets (idempotent)
docker compose up -d --build    # first run builds images — takes a few minutes

open http://localhost:3000      # web app → sign up → create workspace/project
```

No Node available? Copy `.env.example` to `.env` and replace the four `change-me-*` values (`JWT_ACCESS_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY`, `BRIDGE_INTERNAL_TOKEN`) with random 48+ byte strings — the API refuses to boot without them.

- **Check status:** `docker compose ps` — `postgres`/`redis`/`api` should be `healthy`, `migrate` exits `0`, everything else `Up`.
- **API:** http://localhost:4000 (`/docs` for Swagger, `/healthz` for probes).
- **Logs:** `docker compose logs -f api` (same for `worker`, `gateway`, `frontend`).
- **Rebuild after pulling changes:** `docker compose up -d --build`.
- **Stop:** `docker compose down` (add `-v` to wipe the database volume too).
- **Gotchas:** don't run `npm run dev:api` alongside the containers (both want port 4000), and edit provider keys in `.env` (compose reads it via `env_file`).

To hack on the code instead of just running it, use the manual steps below.

---

## 1. Install

```bash
git clone <your-repo-url> ai-harness
cd ai-harness

npm install              # installs all workspaces
```

Generate secrets and create `.env` in one step:

```bash
node scripts/setup-env.mjs    # idempotent — use --force to rotate secrets
```

> **Note:** service URLs in `.env` use `127.0.0.1`, not `localhost`. Using `localhost` against Docker-published ports is a known source of connection failures on some systems.

## 2. Start infrastructure and database

```bash
npm run infra:up         # starts postgres 17.4 + redis 7.4 containers
npm run db:generate      # generates the Prisma client (REQUIRED before first start)
npm run db:migrate       # applies database migrations
```

## 3. Run the platform (3 terminals)

```bash
npm run dev:api        # http://localhost:4000  (+ /docs for Swagger UI)
npm run dev:worker     # BullMQ consumer hosting the Agent Runtime
npm run dev:frontend   # http://localhost:3000
```

Open **http://localhost:3000** and sign up. Create a **workspace**, then a **project** inside it.

## 4. Connect a model provider

In the web app, go to **Providers** and add a connection:

- **Hosted:** paste an Anthropic or OpenAI API key.
- **Local:** point an OpenAI-compatible base URL at Ollama (`http://127.0.0.1:11434/v1`) or LM Studio.

Credentials are encrypted at rest (AES-256-GCM) and never returned by any API. Provider keys are set as environment variables server-side — see [Models & Providers](guides/models-and-providers.md).

## 5. Run your first task

1. Open your project → **New Task**.
2. Describe the outcome you want (a bug fix, a feature, a refactor). Be specific about constraints — see [Core Concepts](concepts.md#planning-protocol) for what the planner expects.
3. The agent moves through the state machine: `QUEUED → UNDERSTANDING → GATHERING_CONTEXT → PLANNING`.
4. If your workspace policy requires it, the plan parks at **`WAITING_FOR_APPROVAL`**. Review the proposed steps, affected files, risks, and verification plan, then approve or reject.
5. The run executes (`EXECUTING → OBSERVING`), requesting individual tool approvals when policy marks an action as `ASK`.
6. Verification runs (`VERIFYING`), an optional read-only reviewer passes (`REVIEWING`), and the run ends in `COMPLETED`.

You can watch every step live: events stream over WebSocket, persist first, and can be replayed if your connection drops — see [Hooks & Events](guides/hooks-and-events.md).

## 6. Verify the install

```bash
npm run typecheck      # strict TS across backend workspaces
npm test               # vitest suite
curl http://localhost:4000/healthz   # API health
```

If anything fails, go to [Troubleshooting](troubleshooting.md).

---

## Next steps

- **Understand the machinery:** [Core Concepts](concepts.md)
- **Walk through eight recipes:** [Examples](examples/README.md)
- **Drive it from code:** [SDK Guide](../SDK_GUIDE.md) · [CLI Guide](../CLI_GUIDE.md)
- **Connect external tools:** [MCP Guide](guides/mcp.md)
- **Ship it for real:** [Self-Hosting](guides/self-hosting.md)

### Running the full test and E2E suite

```bash
npm test                           # unit + integration (vitest)
npx tsx scripts/smoke-vertical-slice.ts   # API smoke suite (server must be up)
npx tsx scripts/e2e-agent-run.ts          # full agent run against a real provider
npm run e2e:bridge                 # bridge pairing → checkpoint → rollback proof
```

### Building for production

```bash
npm run typecheck && npm run lint  # gates
npm run build                      # frontend production build
npm run build:backend              # esbuild bundles → dist/
npm run start:api                  # node dist/api/index.js
npm run start:worker
npm run start:gateway
```

See the [Self-Hosting Guide](guides/self-hosting.md) for full deployment topology, environment variables, and the Terraform GCP stack.
