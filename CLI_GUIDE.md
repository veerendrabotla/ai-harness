# CLI Guide

The `aiharness` binary is the headless face of AI Harness: one thin command
layer over the SDK's REST client. Everything it does — create tasks, stream
events, run CI agents — it does by talking to a running API, exactly like the
web app. The CLI holds **no** model keys, **no** policy, and **no** state of
its own.

- **Single page reference:** every command, every flag, every exit code.
- **Verified against the source** (`backend/packages/cli/src/index.ts`,
  `backend/packages/cli/src/ci.ts`), not against wishful thinking.

---

## Install and run

The CLI ships inside the monorepo as the workspace package `@ai-harness/cli`
(bin: `aiharness`). It is **not published to npm** (private package), so
"install" means one of:

```bash
# from a repo checkout (npm workspaces links the bin for you)
npm install
npx tsx backend/packages/cli/src/index.ts <command>   # explicit form
aiharness <command>                                   # linked form, after npm install

# hack on the CLI itself
npm run dev -w @ai-harness/cli                        # if you add a dev entry
```

`aiharness` is a TypeScript entry point — running it through `tsx` (or a
`node --experimental-strip-types` toolchain) is expected. There is no compiled
dist for the CLI package.

Verify the wiring before anything else:

```bash
aiharness health
# API Status: { "status": "ok", "checks": { "database": "up" } }
echo $?   # 0
```

---

## Configuration and authentication

The CLI reads **environment variables only** — there is no config file, no
`aiharness login`, and no credential cache. That is deliberate: whatever your
shell exports, your pipeline can persist.

| Variable | Meaning | Default |
|---|---|---|
| `AI_HARNESS_URL` | API base URL | `http://localhost:4000` |
| `AI_HARNESS_TOKEN` | JWT access token, sent as `Authorization: Bearer …` | unset |
| `AI_HARNESS_API_KEY` | Also sent as `Bearer …` if set | unset |

Notes, verified against code:

- `AIHarness_URL` (mixed case, no second underscore) is also honored as a
  legacy alias for `AI_HARNESS_URL` — a historical typo we keep for
  compatibility. Prefer `AI_HARNESS_URL`.
- **The API validates JWTs only.** Workspace API keys exist as a resource
  (`ai_<64 hex>`) but are not accepted as Bearer credentials today, so
  `AI_HARNESS_API_KEY` works only if you put a JWT in it. Use
  `AI_HARNESS_TOKEN` for real auth.
- **There is no login command.** Get a token from the API directly:

```bash
API=http://localhost:4000
TOKEN=$(curl -s -X POST $API/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.accessToken")
export AI_HARNESS_URL=$API AI_HARNESS_TOKEN=$TOKEN
```

Access tokens live **15 minutes**; refresh out-of-band with
`POST /v1/auth/refresh` (see [API Reference](docs/API.md)) and re-export. A
stale token surfaces as `API Error (401): …` on the next command.

**Stdout vs stderr:** command results (including CI JSON) go to stdout;
usage errors and diagnostics go to stderr — so `aiharness review --ci
--project p1 --json > result.json` captures a clean payload.

---

## Flags (the complete set)

There are exactly **seven** flags in the whole CLI. If you were looking for
`--help`, `-h`, `--version`, `-f`, `--model`, or `--mode` — they do not
exist (run `aiharness help`, note the exit code quirk in
[Exit codes](#exit-codes)).

| Flag | Type | Default | Accepted by |
|---|---|---|---|
| `--project <id>` | value | — | `build`, `run`, `ask`, `plan`, `fix`, `deploy`, and CI `review`/`test`/`security` (**required** for all of these) |
| `--workspace <id>` | value | — | `sessions` (**required**) |
| `--provider <name>` | value | `default` | `deploy` |
| `--ci` | switch | off | `review`, `test`, `security` |
| `--json` | switch | off (text) | CI commands, only with `--ci` |
| `--github` | switch | off (text) | CI commands, only with `--ci` |

Rules that bite:

- A flag value must actually be present and must not look like another flag.
  `aiharness ask "hi" --project --ci` fails the `--project` check (exit 1).
- **`--json` beats `--github`:** passing both emits JSON, not annotations.
- `--json`/`--github` outside `--ci` are ignored (the CI runner is the only
  thing that formats output).

---

## Command reference

### Task creation — `build`, `run`, `ask`, `plan`, `fix`

```text
aiharness build  <goal>       --project <id>
aiharness run    <prompt>     --project <id>
aiharness ask    <question>   --project <id>
aiharness plan   <description>--project <id>
aiharness fix    <goal>       --project <id>
```

Each creates exactly one task via `POST /v1/tasks` and prints its id and
initial state. The **only** difference between them is the agent mode sent:

| Command | `agentMode` | Behavior |
|---|---|---|
| `build` | `BUILD` | Full plan → approve → execute → verify lifecycle |
| `run` | `BUILD` | Same as `build` (alias for muscle memory) |
| `ask` | `ASK` | Read-only Q&A; no writes, no plan gate |
| `plan` | `PLAN` | Draft a plan and stop; nothing executes |
| `fix` | `FIX` | Failures-first mode (diagnose → patch → re-verify) |

`--project` is **required**: every task belongs to a project (and every
project to a workspace). The SDK resolves the workspace from the project
automatically — you never pass a workspace id here. The goal is everything
after the command name up to the first flag (one argv token, so quote it).

```bash
aiharness build "Add rate limiting to /v1/auth/login" --project 9bc32d2b-…
# Creating task: Add rate limiting to /v1/auth/login
# Task created: 0f0bc404-…
# State: QUEUED
# Stream events: aiharness status 0f0bc404-…
```

Creation is rate-limited server-side at **30 tasks/hour/user** — a burst of
copies returns `429` (the SDK retries 429 with backoff).

### Task control — `status`, `resume`, `events`

```text
aiharness status <task-id>    # GET /v1/tasks/:id  → id, goal, state, created
aiharness resume <task-id>    # POST /v1/tasks/:id/resume  (from INTERRUPTED)
aiharness events <task-id>    # live event stream until terminal state
```

`events` follows the task's event log (incremental `afterSequence`
pagination, 1 s polling) and prints:

```text
Streaming events for task 0f0bc404-…
[9:45:13 am] RUN_STARTED (SYSTEM)
[9:45:14 am] CONTEXT_ASSEMBLED (AGENT)
  {"packageId":"ctx_…","bytes":48213}
…
Stream ended.
```

It stops on a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`) or when an
`INTERRUPTED` task pauses, after a hard 1-hour deadline. Payloads are
truncated to 200 chars per line — use `curl "$API/v1/tasks/:id/events"`
when you need full JSON.

### Sessions — `sessions`

```text
aiharness sessions --workspace <id>
```

Lists a workspace's tasks (tasks **are** sessions in this architecture):
one line each with id, state, goal, and created time. Requires
`--workspace`; membership is enforced server-side — a workspace you do not
belong to returns an empty list or `403`.

```text
  e4b0c85c-…  FAILED                  smoke: list the top-level directories  1/10/2026, 9:45:13 am
  0f0bc404-…  WAITING_FOR_APPROVAL    Add rate limiting to /v1/auth/login    1/10/2026, 9:46:02 am
```

### Deploy — `deploy`

```text
aiharness deploy <environment> --project <id> [--provider <name>]
```

Creates a deployment (`POST /v1/projects/:id/deploy`) and prints the
deployment id + status. `--provider` defaults to `default`. Deployment
targets and their configuration live in the project settings, not in the
CLI.

### Health and help

```text
aiharness health    # GET /v1/health — always prints JSON (unauthenticated-tolerant)
aiharness help      # usage text, exit 0
```

---

## Command → endpoint map

Every command is one API call (plus polling for the long-running ones):

| Command | Endpoint(s) | Notes |
|---|---|---|
| `build` / `run` / `ask` / `plan` / `fix` | `POST /v1/projects/:id` (workspace lookup) → `POST /v1/tasks` | the lookup is internal to the SDK |
| `status` | `GET /v1/tasks/:taskId` | |
| `resume` | `POST /v1/tasks/:taskId/resume` | only from `INTERRUPTED` |
| `events` | `GET /v1/tasks/:taskId/events?afterSequence=…` + `GET /v1/tasks/:taskId` | 1 s poll loop |
| `sessions` | `GET /v1/tasks?workspaceId=…` | membership enforced server-side |
| `deploy` | `POST /v1/projects/:projectId/deploy` | |
| `health` | `GET /v1/health` | unauthenticated-tolerant |
| `review`/`test`/`security` `--ci` | task create → event stream → exit | same task pipeline as the UI |
| `help` | — (local) | exit 0 |

Nothing else runs locally: no model calls, no policy evaluation, no file
access — the CLI machine needs only network access to the API.

---

## CI mode: `review`, `test`, `security`

```text
aiharness review   --ci --project <id> [--json | --github]
aiharness test     --ci --project <id> [--json | --github]
aiharness security --ci --project <id> [--json | --github]
```

With `--ci`, the command creates a task, streams its events until the run
reaches a terminal state, harvests `issues` arrays out of `TOOL_COMPLETED`
event payloads, and exits. Without `--ci`, `review` prints a hint (exit 0)
and `test`/`security` print usage (exit 1).

| Command | agentMode | Goal injected |
|---|---|---|
| `review --ci` | `REVIEW` | "Review the codebase for bugs, security issues, and code quality problems…" |
| `test --ci` | `BUILD` | "Run all tests and report any failures. Analyze test coverage." |
| `security --ci` | `BUILD` | "Perform a security audit. Check for vulnerabilities, secrets…" |

- **Failure semantics:** `passed` flips to `false` only if an issue carries
  `severity: "error"` — warnings and info never fail the build (the runner
  always runs with `failOnIssues: true`).
- **Exceptions** (network death, API errors inside the runner) are converted
  into a synthetic error issue → exit 1.
- Because it is a real task, CI mode consumes your **30 tasks/hour** quota
  and shows up in the audit log like any other task.

---

## Output formats

### Text (default)

```text
CI Result: FAILED
Summary: review completed: 3 issues found in 1234ms

Issues:
  [ERROR] (src/auth.ts:42) Missing input validation
  [WARNING] Consider a named export
```

### JSON — the exact schema

`--json` prints the `CIResult` object, 2-space indented, to stdout — no
wrapper, no envelope:

```json
{
  "passed": false,
  "issues": [
    {
      "severity": "error",
      "file": "src/auth.ts",
      "line": 42,
      "message": "Missing input validation"
    }
  ],
  "summary": "review completed: 3 issues found in 1234ms",
  "duration": 1234
}
```

| Field | Type | Notes |
|---|---|---|
| `passed` | boolean | `false` iff any issue has `severity: "error"` |
| `issues` | `CIIssue[]` | harvested from `TOOL_COMPLETED` event payloads |
| `issues[].severity` | `"error" \| "warning" \| "info"` | defaults to `"info"` when absent in the event |
| `issues[].file` | string? | omitted when the emitter did not attach a path |
| `issues[].line` | number? | omitted alongside `file` |
| `issues[].message` | string | always present |
| `issues[].rule` | string? | emitter-defined rule id, when present |
| `summary` | string | `"<mode> completed: N issues found in Xms"` or `"<mode> failed: <error>"` |
| `duration` | number | wall-clock milliseconds including the full agent run |

`health` also prints JSON (its natural `HealthStatus` shape) regardless of
flags — it is the one non-CI command with structured output.

### GitHub Actions annotations

`--github` emits workflow commands GitHub understands:

```text
::error file=src/auth.ts,line=42::Missing input validation
::warning::Consider a named export
::notice file=README.md::Docs updated
```

`info` severity maps to `notice`. Use it directly in a job step (see the
[recipe](#github-actions-job)) — combined with `--json` it is ignored.

---

## Exit codes

| Code | When |
|---|---|
| `0` | Success: command completed, `help`/no-args, `review` without `--ci` hint, CI run with `passed: true` |
| `1` | Everything else: missing required argument/flag, unknown command, **CI `passed: false`** (error-severity issues or a runner exception), any API/transport error (`401`, `404`, …) |

Two honest footnotes:

- Older docs in this repo claimed `2 = task failed`. **The code only ever
  emits `0` and `1`** — this guide is the contract; treat `1` as "findings
  or failure" and branch on the `--json` payload when you need to tell them
  apart.
- There is no `--help`/`--version`: `aiharness --help` is an *unknown
  command* → exit 1. Use `aiharness help` (exit 0).

---

## Permissions and the CLI

The CLI exposes **no permission flags** — there is no `--allow`, `--deny`,
or `--permission` anywhere. Policy is a server-side workspace concern,
snapshot per run, and enforced by the permission engine inside the worker:

- Rules match **tool names** with `*` wildcards (`filesystem.*`,
  `mcp.*`, `terminal.run`), anchored full-string — not file paths.
- Evaluation order: explicit `DENY` → task-scope approval → exact tool →
  wildcard → risk-level defaults (`READ: ALLOW`,
  `WRITE/DESTRUCTIVE/EXTERNAL: ASK`).
- Forced escalations: `ALLOW` on a `DESTRUCTIVE` tool still asks, and any
  write touching `.env*` asks.
- Verdicts surface as `WAITING_FOR_TOOL_APPROVAL` / `TOOL_DENIED` **events**
  — you approve in the web app or SDK (`approveTool`/`denyTool`), not in the
  CLI.

So "CI passes policy" means: the CI task ran under your workspace's policy,
and anything marked `ASK` parked the run for approval. Full semantics:
[Permissions & Approvals](docs/guides/permissions-and-approvals.md).

---

## Recipes

### GitHub Actions job

```yaml
- name: AI Harness review
  env:
    AI_HARNESS_URL: ${{ vars.AI_HARNESS_URL }}
    AI_HARNESS_TOKEN: ${{ secrets.AI_HARNESS_TOKEN }}
  run: |
    npx tsx backend/packages/cli/src/index.ts review --ci --github --project "$PROJECT_ID"
    npx tsx backend/packages/cli/src/index.ts test   --ci --json   --project "$PROJECT_ID" > test-result.json
  # review exit 1 = error-severity findings; jq the JSON for details
```

### Parse JSON results in a pipeline

```bash
aiharness security --ci --json --project "$PROJECT_ID" > sec.json || true
ERRORS=$(jq '[.issues[] | select(.severity=="error")] | length' sec.json)
jq -r '.issues[] | "\(.severity)\t\(.file // "-"):\(.line // "-")\t\(.message)"' sec.json
test "$ERRORS" -eq 0
```

### Daily driver loop

```bash
export AI_HARNESS_URL=http://localhost:4000 AI_HARNESS_TOKEN=…
aiharness health                                    # 0 before you start
aiharness build "fix flaky checkout test" --project "$PID"
aiharness status <task-id>                          # while you sip coffee
aiharness events <task-id>                          # or watch live
aiharness sessions --workspace "$WS"                # everything at a glance
```

### Reproduce any command without the CLI

The CLI is REST — anything it does, `curl` can:

```bash
curl -s -X POST "$AI_HARNESS_URL/v1/tasks" \
  -H "authorization: Bearer $AI_HARNESS_TOKEN" -H 'content-type: application/json' \
  -d "{\"workspaceId\":\"$WS\",\"projectId\":\"$PID\",\"goal\":\"…\",\"agentMode\":\"BUILD\"}"
```

### Pass a goal from a file (there is no `-f` flag)

```bash
aiharness plan "$(cat docs/goal.txt)" --project "$PID"
# or shell-readable:
GOAL=$(< docs/goal.txt) && aiharness build "$GOAL" --project "$PID"
```

---

## FAQ

**Why does `aiharness --help` exit 1?**
There is no GNU-style help parsing — anything that isn't the word `help` is
an unknown command. `aiharness help` exits 0.

**Can I select the model or mode with a flag?**
No `--model`/`--mode`. Mode is the command you chose; model routing is
workspace configuration ([Models & Providers](docs/guides/models-and-providers.md)).

**Where does the CLI store state?**
Nowhere — no cache, no history file. Ids come from stdout; keep them in
shell variables or pipeline artifacts.

**How do I point it at a remote deployment?**
`export AI_HARNESS_URL=https://api.your-domain` + a JWT. That is the whole
multi-tenant story.

**Can two CI jobs share a token?**
They can, but tokens are 15-minute user credentials — mint one per job from
a service account so audit trails stay attributable.

**Why is my task stuck in `WAITING_FOR_TOOL_APPROVAL`?**
A policy `ASK` fired mid-run. Approve in the web app (the CLI cannot
approve tool calls — see [Permissions](#permissions-and-the-cli)).

**Does `--ci` stream partial output?**
No — CI commands buffer and print once at the end. For live tails use
`events` or the UI.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `API Error (401)` | Expired/absent JWT (15-min TTL) | Re-run the login curl, re-export `AI_HARNESS_TOKEN` |
| `API Error (404)` / `403` | Wrong task/workspace id, or not a member | Check ids; membership is enforced per workspace |
| `Usage: … --project <id>` + exit 1 | Task/CI command without `--project` | Tasks must belong to a project — pass it |
| `Unknown command: --help` + exit 1 | `--help`/`--version` do not exist | `aiharness help` |
| Goal is literally `-f` | The CLI has **no** `-f/--file` flag; positionals are raw | Pass the goal as one quoted argument |
| `429` on create | 30 tasks/hour/user quota | Wait, or reduce CI fan-out |
| `events` ends with a `FAILED` state | The *task* failed (often: no model route for the stage) | `status` + task detail in the UI; [troubleshooting](docs/troubleshooting.md) |
| Connection refused | API not running / wrong URL | `docker compose ps`; check `AI_HARNESS_URL` |

---

## Related reading

- [Getting Started](docs/getting-started.md) — first task in 30 minutes
- [SDK Guide](SDK_GUIDE.md) — the client this CLI wraps, method by method
- [API Reference](docs/API.md) — every endpoint behind these commands
- [Benchmarks](docs/BENCHMARKS.md) — what a CI run costs in time and tokens
- [Use Cases](docs/USE_CASES.md) — copy-paste goals for each mode
