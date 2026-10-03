# Prompt Guide

> How to write task goals, constraints, and revision instructions that make AI Harness
> agents produce the result you actually wanted — six durable rules, the anatomy of what
> reaches the model, and a copy-paste prompt library.
>
> **Audience:** anyone creating tasks (web UI, CLI, SDK). **Length:** ~500 lines.
> **Related:** [concepts.md](concepts.md) · [guides/context-and-memory.md](guides/context-and-memory.md) · [AGENT_RUNTIME.md](AGENT_RUNTIME.md) · [DOCUMENTATION_BENCHMARK.md](DOCUMENTATION_BENCHMARK.md) §6

---

## Contents

1. [How prompting works in AI Harness](#1-how-prompting-works-in-ai-harness)
2. [The six rules](#2-the-six-rules)
3. [Anatomy: what actually reaches the model](#3-anatomy-what-actually-reaches-the-model)
4. [Choosing the right surface](#4-choosing-the-right-surface)
5. [Prompt library](#5-prompt-library)
6. [Advanced techniques](#6-advanced-techniques)
7. [Anti-patterns and fixes](#7-anti-patterns-and-fixes)
8. [Quick reference](#8-quick-reference)

---

## 1. How prompting works in AI Harness

You don't send one prompt. A task run assembles a **context package** from several inputs
you control, then the runtime makes many model calls (plan → one tool action at a time →
verify → review) against that context:

```text
your task goal  ─────────┐
your constraints ────────┤   context engine (120 KB budget, priority-ranked,
workspace instructions ──┼──► fenced untrusted blocks) ──► model calls
project memory ──────────┤   (PLANNING / IMPLEMENTATION / REVIEW stages)
repo analysis + diff ────┘
```

Key consequences for how you write:

- **The goal is the only text that is always priority-packed.** Goal, constraints, system
  and workspace instructions are *mandatory* ranks — everything else (repo map, diffs,
  tool results) competes for the remaining budget and can be dropped (dropped items are
  logged in the context manifest, never silently lost).
- **Everything except the harness's own system instructions arrives fenced** as
  `<untrusted source=...>` — write instructions *for the agent*, not exploit text; the
  model is told your text is data, so imperative, well-structured writing works best.
- **Guidance has a shelf life.** Compaction kicks in at 60% of the context window and
  keeps a "how to continue" handoff summary — long runs reward goals that restate the
  definition of done.

Deep dive: [guides/context-and-memory.md](guides/context-and-memory.md) (priorities,
budget, fences, compaction) · [AGENT_RUNTIME.md §10](AGENT_RUNTIME.md).

---

## 2. The six rules

The industry-standard six rules (Copilot's published set), each applied to how AI Harness
actually consumes your input.

### Rule 1 — General to specific

Open with the outcome, then narrow: what, where, constraints, definition of done.

```text
BAD:  fix the bug

GOOD: Fix the race that drops WebSocket events on reconnect.
Where: frontend/src/hooks/use-task-socket.ts (replay path).
Done when: events emitted while the socket was down are replayed exactly once after
reconnect, covered by a test in frontend/src/hooks/use-task-socket.test.ts.
```

In AI Harness the goal becomes `TASK_GOAL` (mandatory context, rank 3) and the planner is
required to emit ordered, independently verifiable steps — a specific goal produces
specific steps; vague goals produce plans full of "investigate further".

### Rule 2 — Provide examples

Show the shape you want: a snippet of the expected code, a sample output, a before/after.

```text
Add a `formatDuration(ms: number): string` helper to shared/src/time.ts.
Example: formatDuration(93_000) === "1m33s", formatDuration(450) === "450ms",
formatDuration(0) === "0ms". Match the style of formatBytes in the same file.
```

Examples beat adjectives ("clean", "robust") because they constrain the output space.
For multi-file work, put one canonical example in the goal and reference it in
constraints instead of repeating it.

### Rule 3 — Break complex tasks into smaller tasks

Big-bang goals produce long plans, many tool calls, and compaction. Split by outcome:

```text
BAD:  Migrate our API from REST to GraphQL, redesign the frontend, and update docs.

GOOD (three tasks):
  1. "Generate GraphQL schema + resolvers for tasks/projects only; REST stays as-is;
      verify with a contract test comparing both shapes."
  2. "Move the tasks list + detail views to the GraphQL client; no other screens."
  3. "Update docs/API.md and SDK examples for the GraphQL endpoints."
```

Each task gets its own plan, approval, and reviewer pass. Use **PLAN mode** on task 1 to
validate the contract before any execution budget is spent. Workspace policy
(`maxToolCallsPerRun`, `maxTaskDurationSeconds`) enforces this structurally — oversized
tasks fail at the boundary instead of drifting.

### Rule 4 — Avoid ambiguity

Every ambiguous word is a coin-flip the agent takes for you. Disambiguate people, places,
and scope:

```text
BAD:  Clean up the auth code.

GOOD: Refactor authentication to a single verifyToken() entry point.
In scope: backend/apps/api/src/plugins/auth.ts, backend/apps/api/src/lib/auth-service.ts.
Out of scope: the login/signup routes' request shapes (public API — do not change),
token TTL policy, the frontend. Preserve argon2id parameters exactly.
```

"If X, don't touch Y" constraints land in `CONSTRAINTS` (mandatory, rank 4) and are
re-read at every step of the execution loop — they are the cheapest safety lever you have.

### Rule 5 — Indicate format, language, and style

Say what the artifact must look like: language, framework versions, file layout, error
handling style, what to update when you change behavior.

```text
Implement the webhook receiver in backend/apps/api/src/modules/webhooks.
TypeScript, strict mode; zod for payload validation; follow the module pattern used by
modules/tasks (routes file + contract schemas + error mapping via errors.*).
When adding routes, also update docs/API.md and the OpenAPI schema if present.
Tests: backend/apps/api/tests/webhooks.test.ts (vitest, no real network).
```

Naming your conventions means the reviewer stage and your CI don't have to rediscover
them — and it keeps the model from "helpfully" introducing a second pattern.

### Rule 6 — Keep history (context) intact

The harness keeps history for you (recent tool results, git diff, prior-run summary, and
compaction handoffs) — your job is to **not throw away working context**:

- **Resume, don't restart.** Use FIX mode or a follow-up goal that references the prior
  task ("Continue task #123; the failing part is …") instead of restating from scratch —
  `PRIOR_RUN_SUMMARY` and project memory carry the rest.
- **Write revision instructions, not rejections.** When a plan is wrong, use **Revise**
  with a concrete instruction (see [§6](#6-advanced-techniques)) — Reject cancels the
  task and you lose the thread.
- **Milestones over monoliths.** After each completed task, extracted learnings
  (goals > 100 chars become `lesson_learned` memories) feed the next run automatically.

---

## 3. Anatomy: what actually reaches the model

For each model call the context engine packs items in this priority order (rank 1 is
never dropped; the budget is 120 KB by default):

| # | Item | Source you control | Mandatory? |
|---|------|--------------------|------------|
| 1 | System instructions | harness (role + safety constraints) | yes |
| 2 | Workspace instructions | Workspace → Settings → Instructions (versioned) | yes |
| 3 | Task goal | the goal you typed | yes |
| 4 | Constraints (+ appended project memory) | constraints field + auto-extracted memory | yes |
| 5 | Project analysis | auto (repo analysis) | no |
| 6–7 | Current plan / step files | auto (planner output) | no |
| 8–10 | Dependency config, tool results, git diff | auto | no |
| 11–14 | Repo structure, repo map, prior run, MCP resources | auto | no |

What is **not** in the prompt (common misconception):

- **Workspace policy and tool rules** (`ALLOW`/`ASK`/`DENY`) — enforced at execution
  time by the harness, never sent as text.
- **Knowledge base entries** (`KnowledgeEntry`) — searchable via API/UI only.
- **Repo-local instruction files** (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) — not read.
  If it must steer the agent, it belongs in workspace instructions or constraints.

The system message itself is intentionally small: role + "every action is validated,
permission-checked, and may require approval" + safety constraints. All task-specific
smarts ride in the fenced context — which is why *your* inputs carry so much weight.

Mode-specific prompt changes: `REVIEW` and `ASK` get an appended
`[MODE CONSTRAINT: ... read-only ...]` line, and `REVIEW` uses a dedicated read-only
reviewer prompt. `BUILD`/`FIX` share the full plan→approve→execute→verify→review loop.

---

## 4. Choosing the right surface

| You want to… | Put it in | Why |
|---|---|---|
| Define this task's outcome | **Goal** (task create) | Mandatory rank 3; drives the plan schema (`analysis`, `steps`, `verificationPlan`) |
| Bound this task (scope, don't-touch lists, formats) | **Constraints** | Mandatory rank 4; re-read every execution step |
| Set standing team conventions ("we use pnpm", "never edit generated/") | **Workspace instructions** | Mandatory rank 2; versioned; applies to every task in the workspace |
| Forbid/allow actions structurally (no prod DB, ask before shell) | **Policy + tool rules** | Enforced, not prompted — survives prompt-injection attempts |
| Make the agent wait for a human | `requirePlanApproval` policy (default on) | Gate at `WAITING_FOR_APPROVAL` |
| Choose which model runs each stage | Model routes (ROUTED) or task `MANUAL` override | Stages are independent: PLANNING / IMPLEMENTATION / REVIEW |
| Fix a wrong plan before running | **Revise** instruction | Feeds `REVISION INSTRUCTION` into the next plan, new immutable plan version |
| Remember a lesson across tasks | Automatic memory (or memories API) | Extracted on completion/errors; injected into constraints next run |

Mode selection (task `agentMode`):

| Mode | Use when | Runs |
|---|---|---|
| `BUILD` | Normal feature/fix work | plan → approval → execute → verify → review |
| `PLAN` | You want to review the approach first | plan → **stops at approval** |
| `ASK` | Question / analysis, no writes | plan + answer only (read-only) |
| `REVIEW` | "Look at this code and find problems" | read-only review, no plan |
| `FIX` | Repair a known breakage | same lifecycle as BUILD, goal phrased as defect |

---

## 5. Prompt library

Copy-paste starting points. Each entry: the prompt, why it works, recommended mode.
More end-to-end recipes with sample prompts: [examples/README.md](examples/README.md).

### Features

**Small feature (single module)**
```text
Add pagination (cursor-based) to GET /v1/tasks.
- Cursor = opaque base64 of (createdAt, id); default limit 20, max 100.
- Response adds { items, nextCursor } — keep existing item shape unchanged.
- Follow the pattern in modules/projects (routes + contracts + error mapping).
- Update docs/API.md and add tests in backend/apps/api/tests/tasks-pagination.test.ts.
Verify: npm run typecheck && npx vitest run backend/apps/api/tests/tasks-pagination.test.ts
```
*Why:* general→specific, format stated, verification commands given (the plan's
`verificationPlan` mirrors them, and each step's `acceptanceCriteria` must be
asserted by one of those commands — unasserted criteria force a replan). Mode: `BUILD`.

**Feature behind an interface**
```text
Introduce a NotificationChannel interface with two implementations (email, webhook).
First task: define the interface + move the existing email call sites behind it,
behavior-preserving, tests green. Do NOT add the webhook implementation yet.
```
*Why:* splits a big arc (Rule 3) and pins "behavior-preserving" (Rule 4). Mode: `BUILD`.

**Frontend component with its states**
```text
Build a <TaskStateBadge state={TaskState}> component for frontend/src/components.
States: QUEUED (gray), PLANNING/EXECUTING (blue with pulse), COMPLETED (green),
FAILED (red), CANCELLED/INTERRUPTED (muted). Use the existing design tokens from
docs/FRONTEND_GUIDELINES.md (no raw hex values), render as a pill with a dot + label,
and add it to the task table + task detail header. Story: add the component to the
existing component gallery page so all states are visible.
```
*Why:* enumerates the state space (models miss states you don't list) and anchors to
existing tokens so the output doesn't invent a palette. Mode: `BUILD`.

**API integration with failure semantics**
```text
Add outgoing webhooks for task completion events.
- Fire at most once per event id; store delivery log with status PENDING/DEAD.
- Retry schedule 5s/30s/2m/10m, then mark DEAD (a fixed ladder, not exponential
  backoff — same shape as the existing delivery retry ladder).
- Signature header: HMAC-SHA256 of the raw body with the workspace webhook secret,
  header X-AI-Harness-Signature. Document verification in docs/API.md.
- Tests: delivery scheduling + signature format (no real network).
```
*Why:* failure semantics and idempotency are what integrations actually get wrong —
writing them down removes the biggest ambiguity. Mode: `BUILD`.

**Bug fix**
```text
Repro: POST /v1/auth/login returns 500 when the user row has a null displayName
(after the 2026-09 migration). Expected 200.
Root-cause first: report the exact throw site before changing code; the fix must not
change the response contract. Add a regression test reproducing the null column.
```
*Why:* repro + expected behavior + "root-cause first" prevents symptom-patching.
Mode: `FIX`.

### Planning & review

**Plan an unknown area**
```text
Goal: Outline how to add per-workspace SSO enforcement to existing auth middleware.
Mode: PLAN. Do not propose schema changes without listing their migration cost.
Include: affected files, rollout risk, and how we'd verify each step on staging.
```
*Why:* tells the planner what a good plan contains; `PLAN` mode stops before execution.
Mode: `PLAN`.

**Review someone else's PR**
```text
Review the diff on branch feat/rate-limit against main.
Focus on: (1) correctness under concurrent requests, (2) Redis failure behavior,
(3) whether limits are keyed per-user or per-IP. List blocking vs non-blocking
findings with file:line. Do not rewrite code.
```
*Why:* focuses the reviewer budget; matches the reviewer's actual output contract
(`blocking[]`, `non_blocking[]`, `confidence`). Mode: `REVIEW`.

**Ask a architecture question**
```text
ASK: We have one BullMQ queue for tasks and a second for email. Should scheduled jobs
join the task queue or get their own? Compare failure modes (retry storms, poisoned
jobs) for our current setup and recommend one option with rationale.
```
*Why:* `ASK` is read-only (mode constraint appended to instructions) — you get analysis,
not a surprise refactor. Mode: `ASK`.

### Refactors & migrations

**Mechanical rename with blast radius**
```text
Rename the misleading "statsQueue" variable in backend/apps/worker to "taskQueue".
Scope: variable names + log fields only; no Redis key or queue-name changes
(the queue's Redis prefix must stay "task-lifecycle"). Update any tests that assert
the old log field. Finish with a repo-wide grep proving zero stale references.
```
*Why:* explicit non-goals + a self-check the verification stage can run. Mode: `BUILD`.

**Dependency upgrade**
```text
Upgrade fastify from 4.x to 5.x.
- One PR-sized task: package.json + lockfile + config migrations only.
- Known breaks to handle: content-type parser defaults, plugin encapsulation.
- Do not refactor call sites beyond what the upgrade requires.
- Verification: npm run typecheck && npm run lint && RUN_INTEGRATION=1 npm test
```
*Why:* names the known failure modes (models are better at applying than inventing
breakage lists) and pins verification to your real gates. Mode: `BUILD`.

### Tests & docs

**Characterization test for untested code**
```text
Add characterization tests for backend/apps/api/src/lib/rate-limit.ts (no behavior
changes to the source). Cover: window boundary at limit-1/limit/limit+1, per-user key
generation, Redis-down fallback to memory. Use fake timers; no real Redis.
```
*Why:* "characterization" + "no behavior changes" prevents test-driven refactors.
Mode: `BUILD`.

**Doc that must match code**
```text
Rewrite docs/API.md's auth section so every documented route matches the registered
Fastify routes (source of truth: backend/apps/api/src/modules). For each mismatch,
trust the code, fix the doc. End with a table: route | was | now.
```
*Why:* sets the trust direction explicitly — docs-vs-code ambiguity is a classic
coin-flip. Mode: `BUILD`.

### Worked example: same task, three rewrites

**V1 — vague (produces a plausible but wrong-direction plan):**
```text
Improve the notifications system.
```

**V2 — specific (produces a real plan, still some coin-flips):**
```text
Make task completion notifications respect per-workspace preferences.
Add a notification preferences table and check it before sending.
```

**V3 — fully specified (what you want):**
```text
Goal: Honor per-workspace notification preferences for task completed/failed emails.
Done when: a workspace with notifications.completion=false receives no completion
email, default (no row) behaves exactly as today, and an integration test proves both.

Where:
- Add model NotificationPreference { workspaceId, event, enabled } (schema change —
  include the migration in this task).
- Gate: backend/apps/api/src/lib/notifications.ts sendTaskNotification paths.
- Settings UI: workspace settings → Notifications tab (checkbox per event).

Constraints:
- Do not change the email templates or the Resend client.
- Unknown event types must default to enabled (fail-open for notifications only).
- docs/API.md gains the GET/PUT /v1/workspaces/:id/notification-preferences routes.
Verify: npm run typecheck && npx vitest run backend/apps/api/tests/notifications.test.ts
Mode: BUILD (schema change is in-scope for this task; I'll review the plan first —
requirePlanApproval is already on).
```

The progression is always the same: **outcome → where → done-criteria → constraints →
verify**. V3 gives the planner everything the reviewer and your CI will later ask for.

### Constraints showcase (put these in the constraints field)

```text
- Do not modify anything under backend/prisma/ (schema changes are a separate task).
- Public API shapes (status codes, response envelopes) are frozen — additive only.
- Never print or log secrets; use redactValue() for error messages.
- Prefer existing utilities in packages/shared over new dependencies.
- Every behavior change needs a test in the same PR-sized task.
```

---

## 6. Advanced techniques

### Revision instructions (the highest-leverage prompt you write)

When a plan is waiting for approval, **Revise** sends your text back as
`REVISION INSTRUCTION from the human reviewer`, and the planner is told to supersede the
previous plan. Write revisions like diffs to the plan, not vibes:

```text
STRONG: Step 3 is wrong — addDedup should key on jobId, not task id (two runs of the
same task must both enqueue). Also drop step 5 entirely; the sweeper already handles
that case, cite orchestrator.ts if you disagree.

WEAK:  This plan doesn't look right. Try again.
```

Constraints: 1–10,000 chars, only while the task sits at `WAITING_FOR_APPROVAL` with a
draft plan. **Reject** instead = task cancelled, no feedback loop — save Reject for
"never do this task".

### Steering memory (what gets remembered)

- Completed tasks with goals **longer than 100 chars** extract a `lesson_learned`
  memory (confidence 0.7); failures extract `recurring_failure` (0.8).
- Retrieval is keyword-based (first 10 keywords > 3 chars, top 20 memories) and injected
  into constraints as `PROJECT MEMORY (from previous runs)`.
- Practical move: phrase goals with the real nouns (`websocket replay`, `argon2`,
  `BullMQ jobId`) — that's what future runs will match on. Manage/edit memories via the
  project memory viewer or `POST /v1/projects/:projectId/memories`.

### Model routing affects how prompts are taken

- Stages route independently — your plan may run on a different model than execution or
  review. Prompts must be self-contained *per stage* (the plan carries `verificationPlan`
  commands so execution doesn't need your original wording).
- `MANUAL` override pins one `providerConnectionId + modelIdentifier` for the whole run;
  use it when a stage's output format (JSON plan schema) requires a model you trust.
- JSON-schema stages append a "respond with ONLY a single JSON object" suffix
  automatically — never ask the model to "also explain in prose" for PLAN-stage output.

### Keeping long runs on track

- Compaction triggers at 60% of the window and writes a "how to continue" handoff.
  Goals that restate done-criteria survive compaction better than one-liners.
- If a run drifts, prefer a new task with `FIX` mode referencing the old task id over
  piling constraints onto the live run — context is ranked, later constraint spam
  doesn't outrank the goal.

### Policy beats prompting

Anything you'd phrase as "never do X in prod" is more reliable as a tool rule
(`DENY`, or `ASK` for confirmation) than as prose: rules are enforced by the harness
before any tool executes, regardless of what the model decided. See
[guides/permissions-and-approvals.md](guides/permissions-and-approvals.md).

---

## 7. Anti-patterns and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Plan keeps proposing files you didn't mean | Goal too general (Rule 1) | Add "where" + in/out-of-scope lines |
| Agent changes code you thought was frozen | Constraint missing or vague | Explicit "Do not modify X" constraint (mandatory rank) |
| Endless "investigate further" steps | No definition of done | Done-criteria + concrete verify commands in the goal |
| Plan looks right, execution diverges | Model split across stages | Put acceptance criteria in constraints; they're re-read every step |
| Useful context missing from actions | Budget eviction (120 KB) | Tighten goal/constraints; drop paste-dumps of code you don't need |
| Output style inconsistent run-to-run | Style left implicit | Rule 5: name the pattern file + style rules |
| Task got big and muddy halfway | Monolith goal (Rule 3) | Split; use `PLAN` on the first slice |
| You rejected a good-but-flawed plan | Used Reject | Use **Revise** with a diff-style instruction |
| Knowledge base answers not used | Entries aren't injected | Move the must-know part into workspace instructions |
| Agent ignores repo `AGENTS.md` | Not a supported surface | Workspace instructions (they *are* injected, rank 2) |

---

## 8. Quick reference

```text
GOAL          outcome + where + done-when        (always reaches the model)
CONSTRAINTS   scope fences, formats, never-touch  (always reaches the model)
INSTRUCTIONS  standing team conventions           (workspace, versioned, rank 2)
POLICY/RULES  enforced gates, not prose           (never prompted — always enforced)
MODE          BUILD exec · PLAN stop-at-approval · ASK read-only answer
              REVIEW findings-only · FIX defect-lifecycle
REVISE        diff-style instruction on the draft plan (don't Reject good plans)
MEMORY        long goals + nouns → future runs remember; memories are editable
```

**The six rules, one line each:** general→specific · show examples · split big tasks ·
kill ambiguity · state format/style · keep history (revise & resume, don't restart).

### Related reading

- [concepts.md](concepts.md) — planning protocol, context budget, model routing (short)
- [guides/context-and-memory.md](guides/context-and-memory.md) — priorities, fences,
  compaction, memory internals
- [guides/permissions-and-approvals.md](guides/permissions-and-approvals.md) —
  instructions vs policy, tool rules, review gates
- [guides/models-and-providers.md](guides/models-and-providers.md) — stages, routes,
  fallbacks, cost tables
- [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — normalized model request, execution loop
- [examples/README.md](examples/README.md) — eight runnable recipes with sample prompts
- [APP_FLOW.md](APP_FLOW.md) — task lifecycle state machine
