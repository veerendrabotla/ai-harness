# Getting Started

Get AI Harness running locally and complete your first agent task in under
30 minutes.

> **Your first day, in ten moves:** (1) clone and generate secrets —
> 2 minutes · (2) `docker compose up` — 5 minutes while images build ·
> (3) sign up and create a workspace — 2 minutes · (4) connect one model
> (a key, or a local Ollama URL) — 3 minutes · (5) create a project —
> 1 minute · (6) write your first goal — 3 minutes · (7) read the plan the
> agent drafts — 3 minutes · (8) approve it and watch execution — 5 minutes ·
> (9) look at what changed (diff + verification + audit trail) — 3 minutes ·
> (10) roll one thing back just to prove you can — 2 minutes.
> Nothing in that list writes code before you approve it, and step 10 is
> the point: **you stay in control the whole way**.

---

## Choose your path

| You are… | Path | Jump to |
|---|---|---|
| Kicking the tires with a team | **Everything in Docker**, no local toolchain | [Quick start with Docker](#quick-start-with-docker-teams) |
| A developer who wants the code running natively | **From source**, 3 terminals | [1. Install](#1-install) |
| Shipping it for real | **Production containers / GCP** | [Building for production](#building-for-production) + [Self-Hosting](guides/self-hosting.md) |
| Wiring it into CI | **Headless CLI in a pipeline** | [CLI](#first-steps-with-the-cli) + [CLI Guide](../CLI_GUIDE.md) |
| Embedding it in your product | **SDK** | [SDK](#first-steps-with-the-sdk) |

Everything below works the same on every path — only the process manager
differs.

---

## The platform on one page

```text
        you (browser / CLI / SDK / CI)
                     │
     ┌───────────────▼────────────────┐
     │  Web app  ·  API :4000         │  auth · policy · approvals · audit
     │  (plan gates live here)        │  REST + WebSocket + /docs
     └───────┬───────────────┬────────┘
             │               │
      Postgres 17         Redis 7        tasks, events, audit · queues, limits
             │               │
     ┌───────▼───────────────▼────────┐
     │  Worker (Agent Runtime)        │  planning · context assembly · execution
     │  tool calls → permission engine│  verification · reviewer
     └───────┬───────────────┬────────┘
             │               │
       Bridge :4010      model providers        your machine · your keys
      (local tools)      (hosted or local)
```

Five guarantees worth internalizing before your first task:

1. **Task-first.** Everything is a task with a goal, an event trail, and a
   terminal state — not an endless chat.
2. **Explicit execution.** Writes happen after a plan you approve
   (unless you deliberately disable that gate).
3. **Policy-controlled.** ALLOW / ASK / DENY is evaluated per tool call —
   prose in a prompt can never authorize what policy forbids.
4. **Checkpoint before risk.** Destructive operations checkpoint first and
   roll back with one call.
5. **Context is bounded.** The model sees a budgeted, ranked, fenced
   context (120 KB) — not your whole repo dump.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 22.14 (developed on 24 LTS) |
| Docker | with Compose (Postgres 17.4 + Redis 7.4) |
| A model endpoint | an Anthropic/OpenAI key, or any OpenAI-compatible URL (Ollama, LM Studio, vLLM) |

You will need roughly **2 GB free** for images and volumes, and a browser
at `http://localhost:3000`.

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

### What just came up

| Service | Port | Role |
|---|---|---|
| `frontend` | 3000 | Next.js app (task UI, approvals, settings) |
| `api` | 4000 | REST + WebSocket, auth, policy, audit |
| `worker` | — | BullMQ consumer hosting the Agent Runtime |
| `gateway` | 4010 | Bridge gateway (local-machine pairing) |
| `postgres` | — | Tasks, runs, policy, audit (volume `postgres-data`) |
| `redis` | — | Queues, rate limits, realtime (AOF enabled) |

One host, six processes, zero cloud accounts. The API is the only thing
that talks to the database; the worker is the only thing that runs agent
code; you approve both through the web app.

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

- **Hosted:** paste an Anthropic or OpenAI key.
- **Local:** point an OpenAI-compatible base URL at Ollama (`http://127.0.0.1:11434/v1`) or LM Studio.

Credentials are encrypted at rest (AES-256-GCM) and never returned by any API. Provider keys are set as environment variables server-side — see [Models & Providers](guides/models-and-providers.md).

### Local model in four commands (no API key at all)

```bash
ollama pull qwen2.5:3b            # or any chat model you have RAM for
ollama serve                      # usually already running as a service
# Web app → Providers → NEW → OPENAI_COMPATIBLE
#   base URL: http://127.0.0.1:11434/v1     (Docker: http://host.docker.internal:11434/v1)
#   credential: anything (required field, unused by Ollama)
```

Then add **model routes** for the stages you want it to handle
(PLANNING / IMPLEMENTATION / REVIEW) — that is what makes the run actually
use it. Local models meter at **$0** ([pricing](MODELS_AND_PRICING.md#local-and-free-models)).

### Check the connection before you build on it

Playground → pick the connection → send "ping". A reply means the provider
works; a 401/404 means fix the key or base URL first — no need to debug the
agent for a credential problem.

## 5. Run your first task

1. Open your project → **New Task**.
2. Describe the outcome you want (a bug fix, a feature, a refactor). Be specific about constraints — see [Core Concepts](concepts.md#3-planning-protocol) for what the planner expects.
3. The agent moves through the state machine: `QUEUED → UNDERSTANDING → GATHERING_CONTEXT → PLANNING`.
4. If your workspace policy requires it, the plan parks at **`WAITING_FOR_APPROVAL`**. Review the proposed steps, affected files, risks, and verification plan, then approve or reject.
5. The run executes (`EXECUTING → OBSERVING`), requesting individual tool approvals when policy marks an action as `ASK`.
6. Verification runs (`VERIFYING`), an optional read-only reviewer passes (`REVIEWING`), and the run ends in `COMPLETED`.

You can watch every step live: events stream over WebSocket, persist first, and can be replayed if your connection drops — see [Hooks & Events](guides/hooks-and-events.md).

### Three goals worth copying the first time

```text
A) Read-only warmup (ASK):  "Summarize this repository in 5 bullets: purpose,
   entry points, test strategy. Do not propose changes."

B) Small safe change (BUILD): "Add a GET /healthz alias at /health that
   returns {status:'ok'}. Include one test. Touch only the API route layer
   and its tests."

C) Plan-only reconnaissance (PLAN): "Plan how we would move session storage
   to Redis: ordered steps, files touched, rollback notes. Do not execute."
```

Start with **A** (nothing can be written), graduate to **B** (a plan you
approve), keep **C** in your pocket for anything that scares you.

### What you will see the first time

```text
QUEUED → INITIALIZING → UNDERSTANDING → GATHERING_CONTEXT → PLANNING
   → WAITING_FOR_APPROVAL      ← you live here; Approve / Revise / Reject
   → EXECUTING → OBSERVING     ← per-tool ASK approvals pop up mid-run
   → VERIFYING → REVIEWING → COMPLETED
```

### A guided first session (goal B, narrated)

1. **New Task** → paste goal B → keep constraints empty for now → Create.
2. Watch **Activity**: the run gathers context (repo map, relevant files)
   and drafts a plan — typically a route file plus a test file.
3. The plan card shows **steps, files touched, risks, and a verification
   plan**. Read the files-touched list first; it is the contract you are
   approving.
4. Try **Request revision** once with something like "also add the alias to
   the OpenAPI doc" — the next plan folds your note in. This loop is the
   normal way to steer, not a failure.
5. **Approve** the revised plan. Execution starts; if your policy marks
   writes as `ASK`, the first file write parks the run at
   `WAITING_FOR_TOOL_APPROVAL` — approve **for the task** to stop clicking.
6. Watch **Changes** fill in as the diff lands, then **Verification** run
   `npm test` (or whatever the plan promised). Green = done; the reviewer
   then passes through **REVIEWING**.
7. Open the **Context** tab — this is literally what the model saw,
   ranked and fenced. Bookmark it; it answers most "why did it do that?"
   questions.
8. Check **Audit**: `PLAN_APPROVED`, file events, verification results —
   exportable later for compliance.

### Approvals up close

| Gate | Where | Your options |
|---|---|---|
| **Plan approval** | `WAITING_FOR_APPROVAL` | Approve · Request revision (note injected into next plan) · Reject (cancels task) |
| **Tool approval** | `WAITING_FOR_TOOL_APPROVAL` | Allow once · Allow for this task · Deny (run replans or fails) |
| **Security scan** | before completion | Findings can block per policy (`blockOnReviewFindings`) |

Scopes matter: **once** covers exactly that call; **for task** whitelists
that tool for the rest of the run. Deny is absolute — no prompt can
override it. Details:
[Permissions & Approvals](guides/permissions-and-approvals.md).

### Then look at what actually happened

Open the finished task and walk the tabs:

| Tab | What it answers |
|---|---|
| **Plan** | What did it intend to do (and what did you approve)? |
| **Activity / Events** | Every step, replayable after a dropped connection |
| **Changes** | The diff, file by file |
| **Verification** | Which commands ran, did they pass (never faked) |
| **Approvals** | Who approved what, when, with which scope |
| **Context** | What the model actually saw — the 120 KB budget at work |

And prove the undo story: run a checkpoint rollback (`POST
/v1/checkpoints/:id/rollback` with `confirm: true`) and watch files restore —
[Example 8](examples/README.md) walks it line by line.

## 6. Verify the install

```bash
npm run typecheck      # strict TS across backend workspaces
npm test               # vitest suite
curl http://localhost:4000/healthz   # API health → {"status":"ok",...}
```

What "good" looks like: typecheck exits 0 with no output; the test suite
reports hundreds of passing files in ~20 s; health returns JSON with
`checks.database: up`. If anything fails, go to
[Troubleshooting](troubleshooting.md).

---

## The same first task, over the REST API

For readers who trust `curl` more than a UI — the exact calls behind
steps 1–6:

```bash
API=http://localhost:4000

# 1. account + tokens
TOKEN=$(curl -s -X POST $API/v1/auth/signup -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"Str0ngPass!42","displayName":"You"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data.accessToken))")

AUTH="authorization: Bearer $TOKEN"

# 2. workspace + project
WS=$(curl -s -X POST $API/v1/workspaces -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"My WS"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.id")
PROJECT=$(curl -s -X POST $API/v1/workspaces/$WS/projects -H "$AUTH" \
  -H 'content-type: application/json' \
  -d '{"name":"demo","connectionType":"CLOUD","rootReference":"demo"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.id")

# 3. the task (same fields the New Task form sends)
curl -s -X POST $API/v1/tasks -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"workspaceId\":\"$WS\",\"projectId\":\"$PROJECT\",
       \"goal\":\"Add a /health alias with one test\",\"agentMode\":\"BUILD\"}"

# 4. watch it: GET /v1/tasks/:id  (+ /v1/tasks/:id/events for the stream)
```

The WebSocket event feed, `/docs` (Swagger), and the replayable event
pagination are all described in the [API Reference](API.md).

## Things to poke on day one

| Try | Where | Why |
|---|---|---|
| Playground chat | **Playground** | Isolate model behavior from agent behavior; shows per-response cost |
| The Context tab | task detail | See ranked, fenced, budgeted context with your own eyes |
| An event replay | `GET /v1/tasks/:id/events?limit=200` | The source of truth survives dropped connections |
| A DENY rule | Settings → Policy (API) | Prove policy beats prompting: deny `terminal.run`, watch `TOOL_DENIED` |
| Knowledge search | **Knowledge** | Stored answers are searchable, **not** auto-injected into prompts |
| Usage/cost views | **Usage** | Where every token lands: by model, by task, quota status |

## Glossary (the words the UI assumes you know)

| Term | Meaning |
|---|---|
| **Task** | One unit of work: goal + optional constraints + mode, with a terminal state |
| **Run** | An execution attempt of a task (a task can retry → multiple runs) |
| **Plan** | The draft of steps/files/verification you approve before execution |
| **Policy** | Workspace rules enforced per tool call — never sent to the model |
| **Snapshot** | Policy frozen at run start; later edits bind the next run |
| **Route** | Which (stage → provider → model) the runtime calls; stages: PLANNING, IMPLEMENTATION, REVIEW |
| **Checkpoint** | Pre-write snapshot of files, restorable with one call |
| **Bridge** | Local-machine agent that executes tools on your hardware |
| **MCP** | Model Context Protocol — external tool servers the agent can call |
| **Context budget** | The 120 KB cap on what the model sees per call |

---

## First steps with the CLI

The CLI speaks to a running API — the same one Docker just started. `npm
install` links the `aiharness` binary from `@ai-harness/cli` into
`node_modules/.bin`:

```bash
aiharness health                      # exit 0 when API + worker respond
aiharness status                      # recent tasks and their states
aiharness ask "what does this repo do?"   # read-only answer, no plan
aiharness plan -f my-goal.txt         # draft plan, waits for approval in the UI
aiharness run  -f my-goal.txt         # full build lifecycle
aiharness fix  "tests fail in billing"
```

CI shape (exit codes: `0` pass · `1` findings/failures · `2` error):

```bash
aiharness review  --ci --json --github   # PR review annotations
aiharness test    --ci --json            # fix-loop until green, bounded
aiharness security --ci --json           # secret/injection sweep
```

Full reference (every flag, JSON shapes, permission globs):
[CLI Guide](../CLI_GUIDE.md).

## First steps with the SDK

```typescript
import { AiHarnessClient } from "@ai-harness/sdk";

const client = new AiHarnessClient({
  baseUrl: "http://localhost:4000",
  accessToken: process.env.AH_TOKEN!,        // signup/login → accessToken
});

// create a task (mirrors the New Task form)
const { task } = await client.createTask({
  workspaceId,
  projectId,
  goal: "Add a /health alias with one test",
  constraints: "Touch only apps/api route layer and its tests.",
  agentMode: "BUILD",                        // BUILD | PLAN | ASK | REVIEW | FIX
});

// wait for the plan, then steer or approve
if (task.status === "WAITING_FOR_APPROVAL") {
  await client.revisePlan(task.planId, {
    instruction: "Also add the alias to the OpenAPI doc.",
  });
  // ...or: await client.approvePlan(task.planId);
}

// drive it to completion and read the result
const run = await client.getTask(task.id);
console.log(run.status, run.verification?.results);
```

Also available: pause/resume/cancel/retry, task events (the replayable
stream), tool approvals (`approveTool`/`denyTool`), checkpoints, memory
query/add, deployments. Recipes: [SDK Guide](../SDK_GUIDE.md).

---

## Your workspace: the owner's first 10 minutes

Do this before inviting anyone ([Rules & Instructions](RULES_AND_INSTRUCTIONS.md)):

1. **Settings → Instructions** — paste the three things every run should
   know: conventions, hard don't-touch rules, definition of done (template
   in the rules guide). Keep it lean — this text is mandatory context for
   every task.
2. **Settings → Policy** — defaults are sensible (`requirePlanApproval:
   true`, 50 tool calls/run, 30 min). Tighten for a shared workspace;
   leave `maxSubagents` at 0 until you want multi-agent.
3. **Settings → Task Templates** — save one recipe your team will reuse
   ("Fix lint errors" is the built-in example).
4. **Members → Invite** — roles are `OWNER` / `MEMBER` / `VIEWER` (no
   workspace ADMIN — see the [enterprise guide](ENTERPRISE_SETUP.md#roles-and-permissions)).
5. Optional for orgs: SSO config, IP allowlist, audit retention
   (defaults: 90 days) — [Enterprise Setup](ENTERPRISE_SETUP.md).

## Configuration cheat sheet

The `.env` values you are most likely to touch:

| Variable | When to change it |
|---|---|
| `FRONTEND_ORIGIN` | Deploying the web app somewhere else (CORS allow-list, comma-separated) |
| `API_BASE_URL` / `NEXT_PUBLIC_API_URL` | Non-default host/port for API or frontend |
| `RATE_LIMIT_GLOBAL_MAX` | Raising the global limiter (defaults ~100/min) |
| `WORKER_CONCURRENCY` | More parallel agent runs (RAM-bound) |
| `ENCRYPTION_KEY` | Rotation — comma-list `new,old` ([procedure](ENTERPRISE_SETUP.md#secrets-and-encryption)) |
| `SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY` | Turning on error/analytics (inert when empty) |
| `RESEND_API_KEY` + `RESEND_FROM` | Real password-reset/invite email |
| Provider keys | Not in `.env` for users — entered in **Providers** UI (encrypted at rest) |

Full inventory with defaults: [self-hosting §4](guides/self-hosting.md#4-environment-variables).

---

## Common first-run problems

| Symptom | Likely cause | Fix |
|---|---|---|
| `EADDRINUSE :4000` | Containers *and* `npm run dev:api` both up | Pick one; `docker compose down` before native dev |
| API can't reach Postgres/Redis | `localhost` vs `127.0.0.1` in `.env` | Use `127.0.0.1` (see the note in step 1) |
| `Prisma client not found` | Skipped `npm run db:generate` | Run it — required after every fresh install/checkout |
| API boot throws on `CSRF_SECRET` | Production mode without secrets | `node scripts/setup-env.mjs` or fill the four secrets manually |
| API boot throws on Redis | Rate limiter fails closed in production | Start Redis; the API refuses to run without it |
| Signups return **429** | Signup bucket exhausted (100/hr/IP) — common right after a load test | Wait, or flush `ah-rl:*` keys in Redis ([one-liner](BENCHMARKS.md#4-regression-suite-test-floor)) |
| Model 401/404 on first task | Wrong key or base URL | Test in Playground first (step 4) |
| Plan never leaves `PLANNING` | No route for the PLANNING stage, or provider unreachable | Add a model route; check `docker compose logs worker` |
| Web app can't reach API | `NEXT_PUBLIC_API_URL` mismatch | Default `http://localhost:4000`; rebuild frontend after changing |
| `docker compose ps` shows restarting | Missing/blank `.env` values | Regenerate secrets, `docker compose up -d --build` |
| Run sits in `WAITING_FOR_TOOL_APPROVAL` | A policy `ASK` rule fired | Approve once / for task in the UI (or the run times out) |

Still stuck? [Troubleshooting](troubleshooting.md) is the symptom → cause →
fix hub; `docker compose logs -f api worker` is the ground truth.

---

## FAQ (first-run questions)

**Do I need to know Kubernetes?**
No. Compose is the documented path for small teams; Kubernetes is only one
of the later options in [Self-Hosting](guides/self-hosting.md).

**Where are my secrets?**
Generated into `.env` by `scripts/setup-env.mjs`; provider keys are entered
in the UI and stored AES-256-GCM encrypted — they are never returned by any
API and never sent to the model (only the model slug travels).

**Will the agent run `rm -rf` while I sleep?**
No. Destructive commands are policy-gated (`ASK` by default), plans need
approval, checkpoints exist before writes, and the runtime has hard bounds
([Concepts §4](concepts.md#4-execution-loop-and-its-bounds)).

**Does it write to my laptop automatically?**
Not by default. Cloud projects execute in the sandbox. The local **Bridge**
is the explicit pairing channel for running tools on your machine — enable
it when you want file access (or set `EXECUTION_MODE=local`).

**Is my code used to train models?**
No. Your prompt + context goes to the provider *you* configured under your
own key; nothing is retained for training. See
[SECURITY.md](../SECURITY.md).

**Can I use a local model only?**
Yes — Ollama/LM Studio via an OpenAI-compatible base URL, routed by stage
([step 4](#local-model-in-four-commands-no-api-key-at-all)). Quality for
multi-step BUILD tasks varies; ASK/PLAN and small fixes are the sweet spot.

**How much will it cost?**
Local models meter at $0. Hosted: use [Models & Pricing](MODELS_AND_PRICING.md)
worked examples, the Usage tab, and quota alerts ($0.05→$0.25 thresholds).
`npm test` and local runs cost nothing extra.

**What happens when I close the browser?**
Runs continue server-side; events persist and replay on reconnect
([Hooks & Events](guides/hooks-and-events.md)). Your approval decisions are
audited either way.

**How do I wipe everything?**
`docker compose down -v` removes containers, database, and Redis volumes.
That is your full uninstall for the Docker path.

---

## Your first week

A suggested order — each step takes about the time it claims:

| Day | Do this | Time |
|---|---|---|
| 1 | This page, goal A → B, first rollback | 1 h |
| 2 | [Core Concepts](concepts.md) end to end — especially §5 permissions and §7 context | 45 m |
| 3 | [Use Cases](USE_CASES.md) — pick two entries that match your actual work | 30 m |
| 4 | [Prompt Guide](PROMPT_GUIDE.md) §5 — rewrite your day-1 goals the better way | 40 m |
| 5 | [Examples](examples/README.md) #2 (revision loop) and #3 (checkpoints) | 45 m |
| 6 | CLI or SDK path for your workflow ([CLI](../CLI_GUIDE.md) / [SDK](../SDK_GUIDE.md)) | 1 h |
| 7 | [Rules & Instructions](RULES_AND_INSTRUCTIONS.md) — encode your team's rules; invite one teammate | 1 h |

---

## Next steps

- **Understand the machinery:** [Core Concepts](concepts.md)
- **Find your situation, copy a goal:** [Use Cases](USE_CASES.md) (26 workflows)
- **Write better goals:** [Prompt Guide](PROMPT_GUIDE.md)
- **Set the guardrails:** [Rules & Instructions](RULES_AND_INSTRUCTIONS.md)
- **Walk through eight recipes:** [Examples](examples/README.md)
- **Drive it from code:** [SDK Guide](../SDK_GUIDE.md) · [CLI Guide](../CLI_GUIDE.md)
- **Connect external tools:** [MCP Guide](guides/mcp.md)
- **Know what a token costs:** [Models & Pricing](MODELS_AND_PRICING.md)
- **Size it honestly:** [Benchmarks](BENCHMARKS.md)
- **Team/IdP rollout:** [Enterprise Setup](ENTERPRISE_SETUP.md)
- **Ship it for real:** [Self-Hosting](guides/self-hosting.md)

### Running the full test and E2E suite

```bash
npm test                           # unit + integration (vitest)
npx tsx scripts/smoke-vertical-slice.ts   # API smoke suite (server must be up)
npx tsx scripts/e2e-agent-run.ts          # full agent run against a real provider
npm run e2e:bridge                 # bridge pairing → checkpoint → rollback proof
```

> Heavy runs exhaust the signup rate bucket (`ah-rl:*`); flush it before the
> integration suites or their `beforeAll` signups will 429
> ([details](BENCHMARKS.md#4-regression-suite-test-floor)).

### Building for production

```bash
npm run typecheck && npm run lint  # gates
npm run build                      # frontend production build
npm run build:backend              # esbuild bundles → dist/
npm run start:api                  # node dist/api/index.js
npm run start:worker
npm run start:gateway
```

See the [Self-Hosting Guide](guides/self-hosting.md) for full deployment topology, environment variables, and the Terraform GCP stack — or the [Enterprise Setup](ENTERPRISE_SETUP.md) guide for SSO, audit, and hardening before you hand it to a team.
