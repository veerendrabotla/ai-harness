# Rules and Instructions

Everything that steers an agent **before** it acts, and everything that
constrains it **while** it acts. AI Harness has no rules-files convention —
`AGENTS.md`, `CLAUDE.md`, and `.cursorrules` are not read by any code path —
so steering is explicit and comes in **four tiers**: three prompt tiers that
reach the model, and one enforcement tier that never does.

> This doc is the map of the tiers, their caps, and the recipes for writing
> them. Verdict semantics (ALLOW/ASK/DENY) live in
> [Permissions & Approvals](guides/permissions-and-approvals.md); what
> actually reaches the prompt lives in the
> [Prompt Guide §3](PROMPT_GUIDE.md#3-anatomy-what-actually-reaches-the-model).

## Contents

- [The four tiers at a glance](#the-four-tiers-at-a-glance)
- [Tier 1 — Runtime system instructions](#tier-1--runtime-system-instructions)
- [Tier 2 — Workspace instructions](#tier-2--workspace-instructions)
- [Tier 3 — Task-level rules](#tier-3--task-level-rules)
- [Tier 4 — Policy (enforcement, never prompted)](#tier-4--policy-enforcement-never-prompted)
- [What does not exist](#what-does-not-exist)
- [Frontmatter matrix (Cursor feature, mapped)](#frontmatter-matrix-cursor-feature-mapped)
- [Recipes: writing rules that work](#recipes-writing-rules-that-work)
- [Limits and caps](#limits-and-caps)
- [Where rules live in the product](#where-rules-live-in-the-product)
- [Anatomy of one decision](#anatomy-of-one-decision)
- [Conflicts and precedence](#conflicts-and-precedence)
- [FAQ and common mistakes](#faq-and-common-mistakes)

## The four tiers at a glance

| # | Tier | Reaches the prompt? | Editable by | Stored in | Context rank |
|---|---|:--:|---|---|---:|
| 1 | Runtime system instructions | ✅ always | Nobody (harness code) | Code constants | 1 |
| 2 | Workspace instructions | ✅ always | Workspace owner/admin | `workspace_instruction_versions` | 2 |
| 3 | Task rules — goal, constraints, revision, mode line | ✅ (goal yes; constraints first to be cut) | Task creator / reviewer | `tasks`, `plans` | 3–4 |
| 4 | Policy — budgets + tool rules | ❌ never | Workspace owner/admin (API) | `workspace_policies`, `tool_policy_rules` | n/a |

The prompt tiers are ordered by `CONTEXT_PRIORITY` inside a **120,000-byte
context budget**: rank 1–3 are *mandatory* (if they don't fit, the run
fails), rank 4 (constraints) is the **first thing cut** when the budget
overflows. Tier 4 is evaluated per tool call by the permission engine —
policy is enforced, not suggested
([Policy beats prompting](PROMPT_GUIDE.md#policy-beats-prompting)).

## Tier 1 — Runtime system instructions

The harness-authored baseline every planning and implementation call
receives. Not user-editable, not versioned, not configurable — by design:
they encode the guarantees the product makes regardless of workspace
settings.

| Piece | Where it lives | What it does |
|---|---|---|
| `RUNTIME_SYSTEM_INSTRUCTIONS` (4 sentences) | `backend/packages/agent-runtime/src/planner.ts` | Role + "every action is validated against policy and requires approval when marked" framing on PLANNING/IMPLEMENTATION calls |
| Reviewer system prompt | `agent-runtime/src/orchestrator.ts` (REVIEW stage) | Advisory review framing: findings carry confidence, not authority |
| Specialist role prompts (6) + system line | `agent-runtime/src/multi-agent-orchestrator.ts` | Per-role briefs when `maxSubagents > 0` |
| `[MODE CONSTRAINT: … read-only …]` template | 3 code sites in `orchestrator.ts` | Appended for `REVIEW`/`ASK` so a mis-set goal cannot cause writes |
| Playground default prompt | `apps/api` playground routes | `"You are a helpful assistant."` — playground only, never agent runs |

**Implication for rule writers:** tiers 2–4 are yours; tier 1 is the floor
you compose on top of. You cannot weaken it (no instruction can make the
agent skip approvals), only add to it.

## Tier 2 — Workspace instructions

The **"rules file" substitute** — versioned free-text prose that always
enters the context at rank 2, wrapped as untrusted content so injected text
inside it cannot masquerade as system directives.

**Storage & API:**

| | |
|---|---|
| Table | `workspace_instruction_versions` (append-only versions) |
| Endpoints | `GET /v1/workspaces/:id/instructions` (latest, list takes 50 versions) · `POST /v1/workspaces/:id/instructions` |
| Caps | 200,000 chars per POST; **initial instructions at workspace creation are effectively 10,000** (route limit wins over the larger schema limit) |
| UI | Workspace **Settings → Instructions** card; workspace **Create** form |
| Versioning | Every save creates a version — old runs keep pointing at what was in force |

**What belongs here** (durable, workspace-wide, applies to every task):

```text
# Project conventions
- TypeScript strict; no `any` without an eslint-disable comment.
- Tests: vitest. Run `npm test` before considering any change done.
- Style: named exports only; no default exports outside Next.js pages.
- Commit shape: "area: imperative summary" (no conventional-commit prefix).

# Architecture notes the agent cannot infer
- API routes live in backend/apps/api/src/modules/<area>/*.routes.ts.
- Never edit backend/prisma/schema.prisma in a normal task — flag it instead.
- The worker owns all queue work; the API must not import BullMQ directly.

# Definition of done (applies to every task)
1. typecheck + lint + targeted tests green.
2. No new TODOs introduced.
```

**Keep it tight.** Rank 2 is mandatory — a 150 KB instructions blob will
displace everything below it (repo map, constraints) out of the budget. Link
out to deep docs instead of pasting them; the context engine already maps
the repository.

**Version history.** Every `POST` appends a version; the list endpoint
returns the most recent 50. Versions are the audit trail of "what were the
rules when this run happened" — the run records policy snapshot ids
directly, and instruction versions are re-read at each context load, so a
mid-run edit never rewrites a running task's inputs.

## Tier 3 — Task-level rules

Four mechanisms, all scoped to a single task:

| Mechanism | Rank | Cap | Cut first when over budget? |
|---|---:|---|---|
| **Goal** (`Task.goal`) | 3 | 10,000 effective (20,000 schema, 10,000 route) | Never (mandatory) |
| **Constraints** (`Task.constraints`) | 4 | 10,000 | **Yes — first to go** |
| **Revision instruction** (per plan) | injected into planner objective | 10,000 | n/a (planner input) |
| **Mode constraint line** | appended to workspace instructions | fixed template | n/a |

### Goal — what to achieve

The mandatory, indivisible core. Put the **outcome and done-criteria** here;
the [Prompt Guide §5](PROMPT_GUIDE.md#5-prompt-library) has the
vague → specific → fully specified progression.

### Constraints — scope, don't-touch, verify

Optional but the first casualty of a full budget, so spend them on facts the
run cannot rediscover:

```text
- Only touch src/billing/**. Do not modify Prisma schema or migrations.
- The failing behavior: "Invalid Date" for ISO strings with tz offsets.
- Verify: npm test -- billing && npm run lint
```

Two programmatic things land in constraints too:

- **Project memory** — lessons and recurring-failure warnings extracted from
  past runs are appended into the constraints field before the run starts.
- **Nothing else** — policy never lands here; mode lines are appended to
  workspace instructions, not constraints.

### Revision instruction — steering at review time

When a human rejects a draft plan with **Request revision**, the free-text
note is injected into the next planning call as
`REVISION INSTRUCTION from the human reviewer` — the primary mid-flight
steering channel. Same channel is used by failure recovery.

### Agent mode — the strongest rule you can set

| Mode | Behavior | Use when |
|---|---|---|
| `BUILD` (default) | plan → approve → execute → verify → review | Normal delivery |
| `PLAN` | stops at `WAITING_FOR_APPROVAL`; no writes ever | Unknown territory; decide first, execute later |
| `ASK` | read-only answer, no plan | Questions, triage, estimates |
| `REVIEW` | read-only review of existing work; no plan | PR-style review, audits |
| `FIX` | BUILD lifecycle with a defect-shaped goal | Bugs, failing tests |

Mode is a request; the `[MODE CONSTRAINT]` line and policy are the teeth.

## Tier 4 — Policy (enforcement, never prompted)

Policy is configuration, not text. It never enters the model's context —
it is evaluated by the permission engine at every tool call and recorded as
an immutable **snapshot** when a run starts (`POLICY_SNAPSHOT_RECORDED`).
Edits apply to *subsequent* runs, never mid-flight.

**`workspace_policies` scalars:**

| Field | Default | Valid range | Effect |
|---|---|---|---|
| `requirePlanApproval` | `true` | bool | Run pauses at `WAITING_FOR_APPROVAL` before any execution |
| `allowDirectExecution` | `false` | bool | Skips the plan gate entirely (headless/CI shape) |
| `maxTaskDurationSeconds` | 1800 | 60 – 86400 | Run budget clamp |
| `maxToolCallsPerRun` | 50 | 1 – 500 | Run budget clamp |
| `maxSubagents` | 0 | 0 – 5 | `0` disables multi-agent |
| `blockOnReviewFindings` | `false` | bool | Advisory reviewer findings become blocking |

**`tool_policy_rules` rows:**

| Field | Cap | Notes |
|---|---|---|
| `toolName` | 120 chars | Exact or `*`-wildcard match |
| `actionPattern` | 500 chars | Wildcard against the **tool name**, not file paths |
| `riskLevel` | `READ \| WRITE \| DESTRUCTIVE \| EXTERNAL` | Rule tier |
| `decision` | `ALLOW \| ASK \| DENY` | Deny-first evaluation; `DENY` is absolute |

```bash
# Update policy + a tool rule (PUT /v1/workspaces/:id/policy)
curl -X PUT http://localhost:4000/v1/workspaces/$WS/policy \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{
    "requirePlanApproval": true,
    "maxToolCallsPerRun": 30,
    "maxSubagents": 0,
    "toolRules": [
      { "toolName": "terminal.run", "riskLevel": "DESTRUCTIVE", "decision": "ASK" },
      { "toolName": "filesystem.write", "riskLevel": "WRITE", "decision": "ASK" },
      { "toolName": "mcp.*", "riskLevel": "EXTERNAL", "decision": "DENY" }
    ]
  }'
```

```json
{
  "data": {
    "requirePlanApproval": true,
    "allowDirectExecution": false,
    "maxTaskDurationSeconds": 1800,
    "maxToolCallsPerRun": 50,
    "maxSubagents": 0,
    "blockOnReviewFindings": false
  }
}
```

**API vs UI:** the Settings → Policy card edits the six scalars; **tool rules
and `maxSubagents` are API-only** today (rendered read-only in the UI).
Verdict logic, evaluation order, approval scopes, and the `rm -rf` worked
example: [Permissions & Approvals](guides/permissions-and-approvals.md).

## What does not exist

Stated plainly, because docs from other tools assume these exist:

| Expectation (from Cursor/Cline/Claude) | Reality here | Nearest equivalent |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` auto-read | ❌ Not read; zero code references; none in this repo | Workspace instructions (tier 2) |
| Repo/project-scoped rule files | ❌ No project instructions field at all | Workspace instructions + per-task constraints |
| Living docs auto-maintained in-repo (Qoder Repo Wiki) | ✅ `.aiharness/wiki/` is **written** by runs (generated index/changelog + agent topic pages) but **never read** into prompts — output, not steering | Topic pages for humans; workspace instructions for steering |
| Per-file glob rules | ❌ No file-path rule matching | Constraints ("only touch X/**"); `.env` writes escalate automatically |
| Knowledge base auto-injected into prompts | ❌ Knowledge is search-only (UI/API) | Paste the snippet into constraints or instructions |
| Frontmatter in rules files | ❌ No frontmatter parser anywhere | n/a — see matrix below |
| Rules files with `applyTo` globs | ❌ Tool-name wildcards only (`mcp.*`, `filesystem.*`) | Policy `toolName` wildcards |

## Frontmatter matrix (Cursor feature, mapped)

Cursor's rule files carry `alwaysApply`, `applyTo: globs`, and `description`.
Mapped honestly:

| Cursor field | Cursor behavior | AI Harness equivalent |
|---|---|---|
| `alwaysApply: true` | Rule in every chat | **Workspace instructions** — always rank 2, every task |
| `applyTo: ["src/**"]` | Rule only when editing matched files | **No equivalent.** Use task constraints for scope; path awareness exists only for `.env` write escalation |
| `description` | Shown when rule auto-selected | n/a — there is no selection step |
| Rule priority/ordering | File-name ordering | `CONTEXT_PRIORITY` ranks 1–4, fixed |
| One-off override | Per-chat paste | **Constraints** (rank 4) or a **revision instruction** mid-review |
| Deny certain edits | n/a (suggestion only) | **Policy `DENY`** — actually enforced, not suggested |

The honest summary: Cursor rules are *prompt suggestions with file
scoping*; AI Harness splits the same intent into **always-on prose**
(tier 2), **scoped prose** (tier 3), and **enforced boundaries** (tier 4).

### Migration playbook: from rules files to tiers

Bringing an existing repo over (Cursor `.cursor/rules/*.mdc`, Cline
`.clinerules`, Claude `CLAUDE.md`):

| Step | Action |
|---|---|
| 1 | Inventory the old rules; delete anything the repo states unambiguously (redundant prose is budget theft). |
| 2 | `alwaysApply: true` rules → paste into **workspace instructions** (tier 2), deduplicated. |
| 3 | Glob-scoped rules → decide honestly: is it a *style hint* (→ task constraints when relevant) or a *boundary* (→ policy `DENY`/`ASK`)? Globs that only express style often collapse into one workspace sentence. |
| 4 | "Never touch X" rules → **policy** if enforcement matters; constraints if it is per-task. |
| 5 | Command/checklist rules (`npm test` before done) → instructions "Definition of done" block. |
| 6 | Keep the old file **out** of the repo or clearly marked unused — a stale `AGENTS.md` that nothing reads is worse than none. |
| 7 | Verify: create a `PLAN` task in an area covered by a migrated rule and confirm the rule appears in the run's context tab. |

Before (typical Cursor file):

```text
---
alwaysApply: true
---
Use named exports. Run npm test before finishing. Never edit migrations.
```

After (split across tiers):

```text
Workspace instructions (tier 2):
  "Named exports only. Definition of done: typecheck + lint + targeted
   tests green."

Policy (tier 4):
  { "toolName": "filesystem.write", "riskLevel": "WRITE", "decision": "ASK" }
  + constraints on any task that must avoid backend/prisma/migrations/**
```

## Recipes: writing rules that work

### 1. Workspace instructions skeleton

Sections that earn their budget, in priority order: (1) definition of done,
(2) hard don't-touch rules, (3) where things live, (4) style conventions,
(5) verification commands. Cut anything the repo itself already states
unambiguously.

### 2. Constraints micro-patterns

```text
Scope:      "Only src/billing/** and tests/billing/**."
Don't touch: "No dependency version bumps in this task."
Verify:     "npm test -- billing; both new and pre-existing must pass."
Budget:     "If the fix needs >3 files, stop and re-plan instead."
```

### 3. Policy shapes

| Workspace shape | Policy |
|---|---|
| Shared team workspace | `requirePlanApproval: true`, `maxSubagents: 0`, WRITE→ASK defaults, `blockOnReviewFindings: true` |
| CI / headless verification | `allowDirectExecution: true`, tight `maxToolCallsPerRun`, READ-only tool rules |
| Migration freeze | `DENY` rules on `terminal.run`, `filesystem.delete`, `checkpoint.rollback` |
| Power user, solo repo | `requirePlanApproval: false` only if you accept plan-less execution |

### 4. Task templates — rules without copy-paste

Templates (`GET/POST /v1/workspaces/:id/task-templates`) store a name,
description, goal (≤5,000 chars), and `agentMode`; `POST .../:templateId/use`
instantiates a real task (`additionalGoal` appends context). `usageCount`
shows which recipes the team actually reuses. Managed in Settings → Task
Templates. This is the "reusable rule snippet" pattern: put the durable
wording in the template goal, keep workspace instructions for the
workspace-wide layer.

### 5. Choosing where a new rule goes

```text
Applies to every task, forever,        → workspace instructions
Must survive budget pressure           → put it in the goal (rank 3)
Only this task, disposable             → constraints (rank 4)
Should be impossible, not just asked   → policy tier 4
Should stop the run at a gate          → requirePlanApproval / blockOnReviewFindings
Steering after seeing a draft plan     → revision instruction
```

## Limits and caps

| Surface | Effective cap | Note |
|---|---:|---|
| Workspace instructions (POST) | 200,000 chars | |
| Initial instructions (workspace create) | 10,000 chars | Route limit wins over schema's 100,000 |
| Task goal | 10,000 chars | Route limit wins over schema's 20,000 |
| Task constraints | 10,000 chars | |
| Revision instruction | 10,000 chars | |
| Task template goal | 5,000 chars | |
| Instruction version list | 50 versions | |
| Context budget (all prompt tiers) | 120,000 bytes | Rank ≤3 mandatory; rank 4 cut first |
| `maxTaskDurationSeconds` | 60 – 86,400 | |
| `maxToolCallsPerRun` | 1 – 500 | |
| `maxSubagents` | 0 – 5 | |
| `toolName` / `actionPattern` | 120 / 500 chars | Wildcards on tool names |
| Task creations | 30/hour/user | Rate limit |

## Where rules live in the product

| Surface | What you can do |
|---|---|
| **Web → Settings** | Edit instructions (versioned card), edit policy scalars, manage task templates; view tool rules read-only |
| **Web → Workspace create** | Seed initial instructions (≤10,000 chars) |
| **Web → New task** | Set goal, constraints, agent mode, model selection |
| **REST** | `GET/POST /v1/workspaces/:id/instructions` · `GET/PUT /v1/workspaces/:id/policy` · `GET/POST /v1/workspaces/:id/task-templates` (+ `/use`) · `POST /v1/tasks` |
| **SDK** | `createTask({ goal, constraints, agentMode, … })` mirrors the task tier; policy/instructions via REST |
| **Plan review** | Approve / Request revision (revision instruction) / Reject (cancels task) |

## Anatomy of one decision

What happens when an executing task wants to run `terminal.run rm -rf ./build`:

```text
1. Orchestrator asks permission engine: evaluatePermission(snapshot, call)
2. Deny-first: any rule matching toolName "terminal.run" with DENY?  → no
3. Task-level approval pending for this tool/scope?                 → no
4. Exact toolName rule?     "terminal.run" → ASK                    → hit
5. Verdict ASK → approval row created; task parks at WAITING_FOR_TOOL_APPROVAL
6. Human approves ONCE → call executes once; a TASK-scope approval
   would cover the rest of this task only
7. Everything is appended to the event trail (who, what, which snapshot)
```

Ordering, wildcard behavior, DESTRUCTIVE escalation, and the `.env`
exception are specified in
[permissions — evaluation order](guides/permissions-and-approvals.md#evaluation-order).

## Conflicts and precedence

1. **Policy beats prompting.** No instruction can authorize what policy
   denies; DESTRUCTIVE under an `ALLOW` rule still escalates, `.env` writes
   always escalate.
2. **`DENY` is absolute** — deny-first evaluation, no prose override.
3. **Budget precedence:** mandatory rank ≤3 displace optional rank 4;
   oversized tier 2 can crowd the repo map out (keep instructions lean).
4. **Mode constraint is appended** to workspace instructions at execution —
   a `REVIEW` task cannot be argued into writing files.
5. **Memory flows into constraints**, not instructions — check the task's
   constraints if lessons seem missing.
6. **Snapshots freeze policy at run start** — mid-run edits bind the next
   run (`capturedAt` is on the snapshot).

## FAQ and common mistakes

**I wrote rules in `AGENTS.md` — why are they ignored?**
Nothing reads it. Move the content to workspace instructions (always-on) or
task constraints (scoped).

**My constraints keep disappearing from the prompt.**
Rank 4 is cut first when the context budget overflows — usually because
workspace instructions or the goal are bloated. Shrink tier 2/3, or promote
the essential fact into the goal.

**The agent ignores my instructions.**
If it's a *guideline*, check phrasing (imperative, unambiguous, see the
[Prompt Guide](PROMPT_GUIDE.md)). If it should be *impossible*, it was
always a policy rule — prose can only ask.

**I changed policy but the running task still used the old rules.**
By design: the snapshot is captured at run start. Cancel/retry to pick up
the new policy.

**Tool rules won't save from the Settings page.**
Correct — the UI submits scalars only. PUT the policy with `toolRules` via
REST.

**How large is too large for instructions?**
There is no hard failure at 200,000 chars, but anything past a few KB starts
displacing repo context. Treat ~10 KB as the working ceiling (the same cap
as workspace creation).

**Can rules vary per environment (preview vs production)?**
Not via instructions — that is policy territory (`deploy.*` tool rules and
the companion resource engine). See
[permissions](guides/permissions-and-approvals.md#companion-resource-engine).

## Related reading

- [Permissions & Approvals](guides/permissions-and-approvals.md) — verdicts, evaluation order, snapshots, approvals
- [Prompt Guide](PROMPT_GUIDE.md) — what reaches the model; surface-choice matrix
- [Context & Memory](guides/context-and-memory.md) — priority ranks, budget, fences, memory extraction
- [Agent Runtime](AGENT_RUNTIME.md) — normative run-input and assembly spec
- [Core Concepts §2](concepts.md) — tasks, runs, policy snapshot
- [App Flow §5–§9](APP_FLOW.md) — UI flows for instructions, plans, approvals
- [PRD F-02/F-11](PRD.md) — product requirements behind versioned instructions and policy

---

Related: [Models & Pricing](MODELS_AND_PRICING.md) ·
[Use Cases](USE_CASES.md) · [Documentation benchmark](DOCUMENTATION_BENCHMARK.md)
