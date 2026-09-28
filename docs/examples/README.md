# AI Harness — Example Gallery

Eight recipes that exercise the platform end to end. Each entry gives you the **goal**, the **setup**, a **sample prompt** you can paste, the **agent path** the runtime walks, and the **expected outcome**.

All states below are the real task states from [APP_FLOW §15](../APP_FLOW.md) and `TASK_STATES` in `backend/packages/contracts/src/enums.ts`. All commands are real `package.json` scripts or API routes.

Related reading: [README](../../README.md) · [Permissions and approvals](../guides/permissions-and-approvals.md) · [MCP guide](../guides/mcp.md) · [Models and providers](../guides/models-and-providers.md) · [Implementation status](../../IMPLEMENTATION_STATUS.md)

---

## Before you start

```bash
npm install
node scripts/setup-env.mjs
npm run infra:up && npm run db:generate && npm run db:migrate
npm run dev:api        # terminal 1 — :4000
npm run dev:worker     # terminal 2
npm run dev:frontend   # terminal 3 — :3000
```

Every example assumes an account at `/signup`, a workspace (`/workspaces/new`), and at least one connected provider (`/models/providers`) unless the recipe says otherwise.

### How to read the agent path

`QUEUED → PLANNING → EXECUTING → COMPLETED` is a compressed view of the state machine. The states that matter for reading the UI are:

- `PLANNING → WAITING_FOR_APPROVAL` — plan drafted, human gate open (`/tasks/:taskId/plan`)
- `EXECUTING → WAITING_FOR_TOOL_APPROVAL` — a tool needs permission (`/tasks/:taskId/approvals`)
- `EXECUTING → OBSERVING → EXECUTING` — result observed, loop continues
- `EXECUTING → REPLANNING → EXECUTING` — a denial or failure forced a new plan
- `VERIFYING → REVIEWING → COMPLETED` — commands ran, reviewer advisory produced

A `DENY` verdict never executes; it is recorded and the agent replans or fails. Nothing approves its own tool request.

---

## 1. First bug fix

**Goal** — Let the agent find and fix one real defect in a project, with a human approving the plan.

**Setup** — Workspace with a `CLOUD` project (or a Local Bridge root, paired at [`/bridges/new`](../APP_FLOW.md)), provider connected, and a policy that requires plan approval (the gate the scripted E2E in recipe #5 waits on).

**Sample prompt**

```
The date formatter in src/utils/format.ts returns "Invalid Date" for
ISO strings that include a timezone offset. Reproduce it, fix it, and
keep the existing behaviour for date-only strings.
```

**Agent path**

`QUEUED → INITIALIZING → UNDERSTANDING → GATHERING_CONTEXT → PLANNING → WAITING_FOR_APPROVAL → EXECUTING → WAITING_FOR_TOOL_APPROVAL → OBSERVING → VERIFYING → REVIEWING → COMPLETED`

**Expected outcome** — A structured plan waiting at `/tasks/:taskId/plan`. Approve it; the agent then requests file-write permission (approve once, or for the task when policy allows) and works through `EXECUTING`. Open `/tasks/:taskId/changes` for the unified diff and `/tasks/:taskId/verification` for the command results — a command that did not run is recorded `SKIPPED` with a reason, never as a pass. With a bridge-backed root you also get a git checkpoint before the write phase (recipe #3).

---

## 2. Feature with plan approval (and a revision round)

**Goal** — Deliver a multi-file feature where the human steers the plan before any write happens.

**Setup** — Same as #1. Add constraints in the task form to bound scope.

**Sample prompt**

```
Add an endpoint that lists a workspace's failed tasks from the last 7
days, with pagination. Constraints: read-only query, no schema changes,
follow the existing route/response envelope conventions.
```

**Agent path**

`QUEUED → … → PLANNING → WAITING_FOR_APPROVAL → (Request Revision) → PLANNING → WAITING_FOR_APPROVAL → EXECUTING → … → COMPLETED`

**Expected outcome** — In `WAITING_FOR_APPROVAL` you get three choices: **Approve**, **Request revision**, or **Reject** (reject moves the task to `CANCELLED` — that is the documented decision). Requesting a revision returns the task to `PLANNING`; the runtime receives the previous plan plus your instruction and produces a new plan version while earlier versions stay immutable in history. Only the approved version is recorded as `APPROVED`, then execution starts.

---

## 3. Refactor with checkpoints and rollback

**Goal** — Run a broad refactor that snapshots the repo before writing, so you can undo it.

**Setup** — A Local Bridge connected and `CONNECTED` (`/bridges`), project root registered on that bridge, git repository at the root. Checkpoints are git-backed and executed through the bridge.

**Sample prompt**

```
Migrate every call site of logger.info(…) in backend/apps/api to the
new structured helper logEvent(…). Keep message text identical. Do not
touch tests.
```

**Agent path**

`QUEUED → … → PLANNING → WAITING_FOR_APPROVAL → EXECUTING → [checkpoint] → OBSERVING → … → VERIFYING → COMPLETED`

**Expected outcome** — A `checkpoint` row exists before the first write (`GET /v1/tasks/:taskId/checkpoints` shows `stateReference.kind = "git"`). Activity stream records the checkpoint and every subsequent tool call. If verification fails or you dislike the result, roll back with recipe #8 rather than hand-reverting.

---

## 4. Test-fix loop

**Goal** — Let the agent run the suite and iterate until green, bounded by execution limits.

**Setup** — A project whose tests run locally. Default verdicts are `READ → ALLOW` and `WRITE → ASK`, so expect an approval for the test/write steps unless your workspace policy says otherwise ([permissions guide](../guides/permissions-and-approvals.md)). The runtime has hard bounds on duration, tool calls, model invocations and replans.

**Sample prompt**

```
Run the test suite, fix the failing cases in backend/packages/domain,
and re-run until green. Do not weaken assertions or delete tests to
make them pass.
```

**Agent path**

`QUEUED → … → PLANNING → WAITING_FOR_APPROVAL → EXECUTING → OBSERVING → REPLANNING → EXECUTING → … → VERIFYING → REVIEWING → COMPLETED`

**Expected outcome** — Repeated `EXECUTING → OBSERVING` cycles visible in `/tasks/:taskId/activity`, each cycle ending in either a fix or a replan. A failing final verification cannot be reported as success — if the run ends `FAILED`, `/tasks/:taskId/verification` shows which command failed. Bounded replanning means the agent stops instead of looping forever.

---

## 5. Full agent E2E — scripted

**Goal** — Drive the entire vertical slice through the API without touching the UI.

**Setup** — API + worker running, a reachable OpenAI-compatible endpoint (Ollama on `:11434` is the default this script assumes).

```bash
npm run e2e:agent                      # defaults: http://localhost:4000 + model qwen2.5:3b
npm run e2e:agent -- http://localhost:4000 my-model
E2E_PROVIDER_BASE=http://host:11434/v1 npm run e2e:agent
```

**Sample prompt** — the script supplies its own goal: *"Write a short README section explaining how to run the test suite."*

**Agent path**

signup → workspace → project → provider (`OPENAI_COMPATIBLE`) → model routes for `PLANNING` + `IMPLEMENTATION` → `POST /v1/tasks` → polls until `WAITING_FOR_APPROVAL` → fetches the `DRAFT` plan → `POST /v1/tasks/:taskId/plans/:planId/approve` → polls to a terminal state.

**Expected outcome** — Timestamped `[hh:mm:ss]` progress lines ending in a terminal state (`COMPLETED`, or `FAILED` with the reason captured). The approval-gate wait is generous (240 s) but a cold local model can still exceed it; the worker's stuck-run sweeper recovers the orphan as `INTERRUPTED`, and you can re-run. Related: `npm run e2e:smoke` (API smoke), `npm run e2e:resilience` (two workers), `npm run e2e:bridge` (bridge execution).

---

## 6. Local model via Ollama

**Goal** — Run entirely on your own hardware; no cloud key anywhere.

**Setup** — Ollama serving locally, then either of these provider shapes at `/models/providers`:

| Provider type | Credential | Metadata |
|---|---|---|
| `OLLAMA` | not required | `baseUrl: http://localhost:11434` (native adapter, `ollama` SDK) |
| `OPENAI_COMPATIBLE` | any non-empty string | `baseUrl: http://localhost:11434/v1` |

**Sample prompt**

```
Explain what backend/apps/worker/src/worker.ts does on each sweep
cycle, in a table I can paste into the ops runbook.
```

**Agent path**

`QUEUED → INITIALIZING → UNDERSTANDING → GATHERING_CONTEXT → PLANNING → WAITING_FOR_APPROVAL → EXECUTING → VERIFYING → COMPLETED`

**Expected outcome** — Provider status `ACTIVE` after the create-time connection test (`PENDING → ERROR` if Ollama is down). Model routes at `/models/routing` point `PLANNING` and `IMPLEMENTATION` at the local model with priority + fallback chain. Task runs without any outbound model call; pick a model your machine can actually serve — `scripts/e2e-agent-run.ts` defaults to `qwen2.5:3b` for that reason.

---

## 7. MCP server connection

**Goal** — Give the agent tools from an external MCP server, still gated by permissions.

**Setup** — Register at `/mcp/servers/new` (or `POST /v1/mcp/servers`). Servers are created `DISABLED` by design.

```bash
curl -sS -X POST http://localhost:4000/v1/mcp/servers \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"team-docs","transportType":"HTTP","config":{"url":"http://localhost:8931/mcp"}}'
# OWNER on the workspace, then enable (this runs tools/list):
curl -sS -X POST "http://localhost:4000/v1/workspaces/$WORKSPACE_ID/mcp/$SERVER_ID/enable" \
  -H "Authorization: Bearer $TOKEN"
```

`STDIO` transport needs `config.command` and a `CONNECTED` bridge — see the [MCP guide](../guides/mcp.md) §2.3.

**Sample prompt**

```
Using the team-docs MCP server, find every doc that mentions rate
limits and summarise them in one paragraph.
```

**Agent path**

`QUEUED → … → PLANNING → WAITING_FOR_APPROVAL → EXECUTING → WAITING_FOR_TOOL_APPROVAL → EXECUTING → … → COMPLETED`

**Expected outcome** — Server status flips `DISABLED → ACTIVE` on successful discovery (→ `ERROR` if `tools/list` fails). When the agent calls `mcp.call`, risk level `EXTERNAL` defaults to `ASK`, so the task parks in `WAITING_FOR_TOOL_APPROVAL` at `/tasks/:taskId/approvals`. Approve once (or for the task) and the call is retried; deny and the agent replans or fails.

---

## 8. Checkpoint rollback

**Goal** — Undo a task's file changes to a known-good git state, with an audit trail.

**Setup** — From recipe #3: a checkpoint created before execution, `stateReference.kind === "git"` with a `ref`, project root on a `CONNECTED` bridge.

```bash
curl -sS "http://localhost:4000/v1/tasks/$TASK_ID/checkpoints" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, checkpointType, stateReference}'

curl -sS -X POST "http://localhost:4000/v1/checkpoints/$CHECKPOINT_ID/rollback" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"confirm":true}'
```

**Sample prompt** — n/a, this is an operator action; the task itself does not need a new goal.

**Agent path** — Rollback is a human action outside the state machine. The bridge executes `ckpt.rollback` against the root; the API records audit `CHECKPOINT_ROLLED_BACK` and emits a `STATE_CHANGED` event into the task activity stream.

**Expected outcome** — Working tree reset to the checkpoint ref. Failure modes are structured, never fake success: missing `confirm: true` → validation error; non-git checkpoint → `CONFLICT`; bridge not `CONNECTED` → bridge-disconnected error. The task's own state does not change — retry the task (`POST /v1/tasks/:taskId/retry`) to start a fresh run from the rolled-back tree.

---

## Sanity checks

```bash
npm test              # unit suite
npm run typecheck     # strict TS across backend workspaces
npm run lint          # eslint (backend); npm run lint:frontend for Next
npx tsx scripts/smoke-vertical-slice.ts   # API smoke, server must be up
curl -s http://localhost:4000/healthz
```

Where an example promises behaviour the platform does not have yet (Cloud Sandbox execution, email delivery of reset links, `.well-known` MCP discovery), the [implementation status](../../IMPLEMENTATION_STATUS.md) and [deployment checklist](../../EXTERNAL_DEPLOYMENT_CHECKLIST.md) are the authority — this gallery only documents what is implemented.
