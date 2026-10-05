# AI Harness

A **model-independent agentic development environment**: a PWA control plane where AI coding agents understand projects, assemble bounded context, draft structured plans, request human approval, execute policy-controlled tools, verify their work, and leave a complete auditable trail.

Built from the product specifications in [`docs/`](docs) (PRD, APP_FLOW, TECH_STACK, FRONTEND_GUIDELINES, BACKEND_STRUCTURE, AGENT_RUNTIME).

**Bring your own keys, no markup.** Provider credentials (Anthropic, OpenAI, Ollama, any OpenAI-compatible endpoint) are AES-256-GCM encrypted in your own database and never returned by the API. Model tokens are billed directly by your provider — AI Harness never resells or marks up usage.

**Private by default.** The full stack self-hosts on your own infrastructure: source code, prompts, plans, artifacts, and audit trails stay inside your servers. Only the context you explicitly approve is sent, and only to the model provider you configured.

**Start here:** [Install](docs/INSTALL.md) · [Documentation hub](docs/README.md) · [Getting Started](docs/getting-started.md) · [Core Concepts](docs/concepts.md) · [Self-Hosting](docs/guides/self-hosting.md) · [Troubleshooting](docs/troubleshooting.md) · [`llms.txt`](llms.txt)

## Download / install

| What | How |
|---|---|
| **Windows app** | [AI-Harness-Setup-x64.exe](https://github.com/veerendrabotla/ai-harness/releases/latest/download/AI-Harness-Setup-x64.exe) (or [portable](https://github.com/veerendrabotla/ai-harness/releases/latest/download/AI-Harness-Portable-x64.exe)) |
| **Web stack (Linux/macOS)** | `curl -fsSL https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.sh \| bash` |
| **Web stack (Windows)** | `irm https://raw.githubusercontent.com/veerendrabotla/ai-harness/main/install.ps1 \| iex` |
| **VS Code extension** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=ai-harness.ai-harness) or `.vsix` from [Releases](https://github.com/veerendrabotla/ai-harness/releases/latest) |
| **All platforms + checksums** | [docs/INSTALL.md](docs/INSTALL.md) · [Releases](https://github.com/veerendrabotla/ai-harness/releases) |

---

## Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│  frontend/  Next.js 15 PWA (React 19, Tailwind 4, Radix,           │
│             Zustand, TanStack Query, Serwist service worker)       │
└──────────────┬─────────────────────────────────────────────────────┘
               │ REST (JSON envelopes) · Socket.IO realtime events
┌──────────────▼─────────────────────────────────────────────────────┐
│  backend/apps/api        Fastify 5 control plane                   │
│   modules/   auth · workspaces · projects · instructions-policy    │
│              providers · tasks · plans · approvals · activity      │
│              bridges · mcp                                         │
│   plugins/   jwt auth · rate-limit · error handler · swagger       │
│              socket.io fan-out (Redis pub/sub across replicas)     │
┌──────────────▼─────────────────────────────────────────────────────┐
│  backend/apps/worker     BullMQ consumer hosting the Agent Runtime │
└──────────────┬─────────────────────────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────────────────────────┐
│  backend/packages                                                  │
│    contracts         zod schemas shared by frontend + backend      │
│    domain            task state machine (XState), roles, failures  │
│    permission-engine ALLOW / ASK / DENY evaluation                 │
│    tool-harness      registry, schema validation, bounded exec     │
│    context-engine    budgeted context assembly + manifests         │
│    model-adapters    Anthropic / OpenAI / OpenAI-compatible        │
│    agent-runtime     orchestrator, planner, router, approvals,     │
│                      checkpoints, verification, events             │
│    database          Prisma client + repositories (PostgreSQL 17)  │
│    shared            env validation, errors, crypto, redaction     │
└────────────────────────────────────────────────────────────────────┘
```

Key guarantees implemented:
- One active run per task; every state transition validated against a centralized XState-derived edge table and persisted with an event.
- Every tool action resolves through `Permission Engine` before `Tool Harness`; DENY is absolute, ASK creates expiring approvals, humans decide.
- Provider credentials are AES-256-GCM encrypted at rest and never returned by any API.
- Secrets are redacted from logs, event payloads, context packages and tool results.
- Realtime events persist first, then fan out; clients resume via `afterSequence`.


## Platform support

| Component | Windows | macOS | Linux | Android | iOS/iPadOS |
|---|---|---|---|---|---|
| PWA control plane (browser) | ✅ | ✅ | ✅ | ✅ installable | ✅ installable (Safari) |
| API / Worker / Gateway (Node 22+) | ✅ | ✅ | ✅ | — | — |
| Local Bridge agent (needs filesystem + git) | ✅ | ✅ | ✅ | ❌ | ❌ |

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 22.14 (developed on 24 LTS) |
| Docker | with Compose |
| A model endpoint | any OpenAI-compatible URL (Ollama, LM Studio, vLLM…) or an Anthropic/OpenAI key |

## Installation

### Option A — Docker (just run it)

Everything runs in containers — API, worker, gateway, web app, Postgres, Redis:

```bash
git clone <your-repo-url> ai-harness
cd ai-harness

node scripts/setup-env.mjs      # one-time: creates .env with fresh random secrets
docker compose up -d --build    # first build takes a few minutes
```

Open **http://localhost:3000** and sign up. Full details: [docs/getting-started.md](docs/getting-started.md).

### Option B — local development (Node + npm)

```bash
npm install              # installs all workspaces

node scripts/setup-env.mjs   # creates .env with fresh secrets (idempotent)

npm run infra:up         # starts postgres 17.4 + redis 7.4 containers
npm run db:generate      # generates prisma client (REQUIRED before first start)
npm run db:migrate       # applies prisma migrations
```

## Running locally (3 terminals)

Skip this section if you used Docker above.

```bash
npm run dev:api        # http://localhost:4000  (+ /docs for Swagger UI)
npm run dev:worker     # task-lifecycle queue consumer
npm run dev:frontend   # http://localhost:3000
```

## Running tests

```bash
npm test               # vitest suite (state machine, permissions, harness,
                       # context engine, crypto/redaction/env, contracts)
npx tsx scripts/smoke-vertical-slice.ts    # API smoke suite (server must be up)
npx tsx scripts/e2e-agent-run.ts [model]   # full agent run vs real provider
```

## Build commands

```bash
npm run typecheck      # strict TS across backend workspaces
npm run lint           # eslint (backend) ; npm run lint:frontend for Next
npm run build          # next build (frontend) — backend runs via tsx
```

## Project structure

See the tree above; route inventory lives in `frontend/src/app`, API surface under `backend/apps/api/src/modules/*`. Database schema: `backend/prisma/schema.prisma`.

## Current implementation status

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the honest per-subsystem breakdown, [DECISIONS.md](DECISIONS.md) for spec-conflict resolutions, and [TODO_NEXT_PHASE.md](TODO_NEXT_PHASE.md) for the prioritized roadmap.
