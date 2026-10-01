# Use Cases

Twenty-six templated workflows you can run today — each one a copy-paste
goal, the context it draws on, the artifacts it produces, and the
permissions it needs. Modeled on Replit's workflow gallery and Lovable's
vertical templates, but grounded in what this platform's task system,
tool registry, and policy engine actually do.

> **How this fits the docs:** the [Example Gallery](examples/README.md)
> contains **8 deep walkthroughs** (step-by-step, with expected state
> transitions); the [Prompt Guide](PROMPT_GUIDE.md) teaches **prompt
> technique**; this page is the **browse-by-intent catalog** — find your
> situation, copy the goal, adjust constraints, run it.

## Anatomy of an entry

Every entry uses the same six fields:

| Field | Meaning |
|---|---|
| **Problem** | The situation, in one or two sentences |
| **Goal** | Copy-paste text for the task's goal field |
| **Context** | What the run draws on (instructions, repo map, MCP, memory) |
| **Artifacts** | What exists after the run (plan, diff, verification, report) |
| **Permissions** | Modes, approvals, and policy knobs that matter |
| **Surface** | Where to drive it from: Web, CLI, SDK, CI, Bridge |

**Modes** used below: `BUILD` (plan→approve→execute→verify→review) ·
`PLAN` (stops at approval, no writes) · `ASK` (read-only answer) ·
`REVIEW` (read-only review) · `FIX` (BUILD shaped at a defect).
Full semantics: [Rules and Instructions](RULES_AND_INSTRUCTIONS.md#agent-mode--the-strongest-rule-you-can-set).

## Contents

1. [Bugfix and diagnosis (3)](#1-bugfix-and-diagnosis)
2. [Feature delivery (3)](#2-feature-delivery)
3. [Plan-first work (2)](#3-plan-first-work)
4. [Refactor and migration (3)](#4-refactor-and-migration)
5. [Tests and verification (2)](#5-tests-and-verification)
6. [Code review and QA (2)](#6-code-review-and-qa)
7. [Security (2)](#7-security)
8. [Docs and knowledge (2)](#8-docs-and-knowledge)
9. [CI/CD and operations (2)](#9-cicd-and-operations)
10. [Safety, policy, and recovery (2)](#10-safety-policy-and-recovery)
11. [Local and private execution (1)](#11-local-and-private-execution)
12. [Team and governance (1)](#12-team-and-governance)
13. [Prompt-to-app builder (1)](#13-prompt-to-app-builder)

---

## 1. Bugfix and diagnosis

### 1. Repro-first bug fix

`FIX` · Web or CLI

**Problem.** A bug is reported but not understood; you want a reproduction
before anyone edits code.
**Goal.**

```text
Reproduce then fix: ISO strings with timezone offsets render "Invalid Date"
in the task list. 1) Write a failing repro test. 2) Find the parse path.
3) Fix it without changing the public date format. 4) Run the date-related
tests plus the new repro.
```

**Context:** workspace instructions (conventions), repo map (auto),
task constraints if the date code spans packages.
**Artifacts:** repro test, minimal diff, verification results, event trail.
**Permissions:** default plan approval; WRITE→ASK per file; first checkpoint
before the first write.
**Surface:** Web (task detail → plan → approve) or `aiharness fix "<goal>" --project <id>`.

### 2. Root-cause hypothesis tree

`ASK`, then `FIX` · Web or CLI

**Problem.** An intermittent failure resists direct fixes; you need
hypotheses with verification steps first.
**Goal.**

```text
Hypothesize why a login redirect loop can occur between middleware and
session refresh. For each hypothesis: the exact file to inspect, the signal
that would confirm it, and the smallest change that would fix it. Do not
modify files — deliver the ranked analysis only.
```

**Context:** repo map, auth middleware sources, workspace instructions.
**Artifacts:** ranked hypothesis list with evidence pointers (an `ASK` run
produces no diff — that is the point).
**Permissions:** ASK mode is read-only by mode constraint; promote to `FIX`
with the winning hypothesis appended as `additionalGoal`.
**Surface:** Web, CLI (`aiharness ask "<q>" --project <id>`), or SDK (`createTask` mode `ASK`).

### 3. Failing-test triage

`FIX` · CLI or CI

**Problem.** The suite is red after a merge; someone must separate real
breakage from environment noise.
**Goal.**

```text
Run the test suite, group failures into (a) real regressions and (b)
environment/flake, fix group (a) only, and re-run until green. Cap at 3
replans; if still red, stop and report the remaining failures with evidence.
```

**Context:** `verificationPlan` commands, CI logs if triggered from CI,
workspace instructions (test conventions).
**Artifacts:** green suite or an evidence report; bounded by
`maxToolCallsPerRun` and `maxTaskDurationSeconds`.
**Permissions:** `FIX` mode; plan approval before the first edit.
**Surface:** CI (`aiharness test --ci --json --project <id>`, exit 0/1) or CLI.

## 2. Feature delivery

### 4. Small API feature with tests

`BUILD` · Web or CLI

**Problem.** A product-sized endpoint request that should land with tests
the first time.
**Goal.**

```text
Add GET /v1/workspaces/:id/activity returning the workspace's recent audit
events, cursor-paginated (limit ≤100, afterSequence), newest first.
Include: route in the existing module style, Zod request schema, 3 tests
( happy path, bad cursor, role-denied ). Do not touch other routes.
```

**Context:** sibling routes as patterns, workspace instructions (module
layout), repo map.
**Artifacts:** plan → approved diff, new route file, tests, verification
results, audit event trail of the run itself.
**Permissions:** plan approval on; constraints scoping to the module.
**Surface:** Web or SDK (`createTask` with `constraints`).

### 5. Frontend component with the full state space

`BUILD` · Web

**Problem.** UI components often ship covering only the happy state.
**Goal.**

```text
Build a TaskStatusPill component covering QUEUED, PLANNING, EXECUTING,
COMPLETED, FAILED, CANCELLED, INTERRUPTED. Use the design tokens from
docs/FRONTEND_GUIDELINES.md (no raw hex), render as pill (dot + label),
accept an optional size prop, and add a gallery page section showing every
state.
```

**Context:** frontend design guidelines doc, existing component gallery,
workspace instructions (style).
**Artifacts:** component file, gallery entry, typecheck + build results.
**Permissions:** plan approval; WRITE→ASK on `frontend/**` only.
**Surface:** Web.

### 6. Multi-file feature without losing the thread

`BUILD` · Web · Persona B

**Problem.** Cross-package features sprawl; the agent loses project
instructions mid-run.
**Goal.**

```text
Implement feature-flag evaluation for the API: contracts type, a flag
lookup in the settings module, enforcement middleware, docs entry in
docs/API.md, and one integration test. Follow workspace instructions
throughout; if any step would require touching Prisma, stop and request a
revision instead.
```

**Context:** workspace instructions (this is their killer use case),
repo map across `contracts/` and `apps/api/`, knowledge base for prior
decisions (search, not injected).
**Artifacts:** plan spanning 4+ files, diff, verification, review findings.
**Permissions:** plan approval with a revision round available; explicit
stop-condition in constraints.
**Surface:** Web (task detail tabs: plan / activity / changes / verification).

## 3. Plan-first work

### 7. Explore-and-plan an unknown area

`PLAN` · Web or CLI

**Problem.** You need a reviewed plan before any code is touched — unknown
territory, high blast radius.
**Goal.**

```text
Plan (do not execute) how to replace the legacy session store with Redis
sessions: ordered steps, files touched per step, migration/rollback notes,
and test impact. Recommend which steps need checkpoints.
```

**Context:** repo map, docs (`AGENT_RUNTIME.md`, `guides/self-hosting.md`),
workspace instructions.
**Artifacts:** a plan at `WAITING_FOR_APPROVAL` — approve later to execute,
revise to steer, reject to cancel (nothing was written).
**Permissions:** `PLAN` mode (no execution possible); plan approval gate is
the deliverable's home.
**Surface:** Web, or `aiharness plan "<goal>" --project <id>`.

### 8. Feature delivery with a revision round

`BUILD` · Web

**Problem.** First drafts of larger features are rarely right; you want to
steer before execution.
**Goal.**

```text
Add a paginated GET /v1/audit-entries endpoint with filters (actor, action,
date range). Include Zod schemas, 4 tests, and an OpenAPI-style doc entry.
```

**Context:** repo map, sibling pagination code, workspace instructions.
**Artifacts:** draft plan → **revision instruction** → revised plan →
execution; both plans visible in history.
**Permissions:** plan approval; reject-with-revision carries your note into
the next planning call (`REVISION INSTRUCTION from the human reviewer`).
**Surface:** Web — the full walkthrough is
[Example 2](examples/README.md).

## 4. Refactor and migration

### 9. Mechanical rename with blast-radius guardrails

`BUILD` · Web or CLI

**Problem.** A rename touches hundreds of sites; one missed import breaks CI.
**Goal.**

```text
Rename every logger.info call to logEvent across backend/. Constraints:
no behavior change, no signature changes, keep import churn minimal.
Stop and report if you find call sites using logger.info with lazy-format
strings rather than structured fields.
```

**Context:** repo map (find all call sites), workspace instructions.
**Artifacts:** plan with the blast-radius count, mechanical diff,
verification (`typecheck` + `lint` + targeted tests).
**Permissions:** scope constraints; WRITE→ASK; checkpoint before first edit.
**Surface:** Web or SDK.

### 10. Migration with checkpoint and rollback path

`BUILD` · Bridge

**Problem.** Broad refactors need a proven undo before the first write.
**Goal.**

```text
Migrate the payment module from direct console.log calls to the shared
logEvent helper. Create a checkpoint before the first modification. After
verification, report the checkpoint id and confirm rollback works if
reverted.
```

**Context:** bridge-connected workspace (checkpoint tools are
bridge/INTERNAL-bound), workspace instructions.
**Artifacts:** checkpoint, diff, verification, `CHECKPOINT_CREATED` /
rollback evidence.
**Permissions:** checkpoint-first pattern; `checkpoint.rollback` is
DESTRUCTIVE → ASK.
**Surface:** Bridge-backed run — full walkthrough:
[Example 3](examples/README.md) (`npm run e2e:bridge` exercises it).

### 11. Dependency major upgrade

`PLAN` then `BUILD` · Web or CLI

**Problem.** Major version bumps need a migration plan someone has reviewed.
**Goal.**

```text
Plan the upgrade of Fastify 4 → 5: breaking changes that affect this repo
(from node_modules types + changelog), ordered steps, files touched,
rollback strategy. If the plan looks safe, execute it with typecheck as the
gate after each step.
```

**Context:** repo map, `docs/TECH_STACK.md`, workspace instructions.
**Artifacts:** upgrade plan, staged diff, typecheck/build verification.
**Permissions:** plan approval between planning and execution; constraints
cap dependency edits to the named packages only.
**Surface:** Web or CLI.

## 5. Tests and verification

### 12. Characterization tests for untested code

`BUILD` · CLI

**Problem.** Legacy code has no tests, so refactors feel dangerous.
**Goal.**

```text
Add characterization tests for backend/apps/api/src/lib/usage-tracking.ts:
cover estimateCost for known models, provider-prefixed ids, legacy aliases,
and the unknown-model fallback. Assert current behavior only — no
production code changes.
```

**Context:** source file, canonical pricing table, workspace instructions
(test style).
**Artifacts:** test file(s), coverage delta in the verification report.
**Permissions:** read-mostly; WRITE→ASK limited to `tests/**`.
**Surface:** CLI (`aiharness build "<goal>" --project <id>`).

### 13. Test-fix-until-green loop

`FIX` · CI or CLI

**Problem.** A merge left the suite red; automation should close the loop
within bounds.
**Goal.**

```text
Make `npm test` pass without changing test expectations. Fix production
code, not assertions, unless an assertion is provably wrong (quote it).
Bounded: max 3 replans, then report remaining failures with stack evidence.
```

**Context:** CI logs (`--json`), workspace instructions, memory lessons
(flintake patterns append into constraints automatically).
**Artifacts:** green run or bounded failure report; replan history visible.
**Permissions:** `FIX` mode; `maxTaskDurationSeconds` and tool-call budget
as the hard stops; `blockOnReviewFindings: true` if reviewer vetoes count.
**Surface:** CI (`aiharness test --ci --json --github --project <id>`) or CLI.

## 6. Code review and QA

### 14. Read-only change review

`REVIEW` · Web

**Problem.** A branch needs review for correctness and risk, not style wars.
**Goal.**

```text
Review the current changes: correctness risks first, then security smells,
then performance. Classify each finding as blocking or non-blocking with
confidence. Reference file:line. Read-only — do not propose patches yet.
```

**Context:** `git diff` via READ tools, workspace instructions (review
priorities), plan/approval history of the task under review.
**Artifacts:** findings list (advisory unless `blockOnReviewFindings` is
set), stored on the run.
**Permissions:** `REVIEW` mode (read-only by mode constraint); policy
`blockOnReviewFindings` decides whether findings gate anything.
**Surface:** Web — task detail → review findings.

### 15. CI diff review with PR annotation

`REVIEW` · CI

**Problem.** Reviews should run on every PR without waiting for a human.
**Goal.**

```text
aiharness review --ci --github --project <id>
```

**Context:** PR diff in CI, exit codes 0/1, `--json` for machine output.
**Artifacts:** findings + `--github` annotations on the PR; CI job status.
**Permissions:** read-only mode; CI token with comment scope;
`allowDirectExecution` not required (REVIEW never writes).
**Surface:** CI — wire into `.github/workflows` alongside the existing
lint/typecheck/test jobs.

## 7. Security

### 16. Security-gate findings as a task

`BUILD` · Web

**Problem.** The security scan gate found issues; someone must fix them
without regressions.
**Goal.**

```text
Resolve the security-scan findings for this task: HARDCODED_SECRET → move
to env with a lookup helper; SQL_INJECTION → parameterized query; keep
behavior identical, add one regression test per fix.
```

**Context:** scan-gate results (finding types), workspace instructions.
**Artifacts:** fixes + tests, re-scan result, review findings.
**Permissions:** plan approval; `blockOnReviewFindings: true` so a clean
scan is mandatory; DESTRUCTIVE tools stay ASK.
**Surface:** Web — fix loop over task detail → verification tabs.

### 17. CI security sweep and secret audit

`REVIEW`/`ASK` · CI or CLI

**Problem.** You want a standing audit for secrets and injection surfaces
after every change.
**Goal.**

```text
aiharness security --ci --json --project <id>
```

**Context:** repo tree, finding taxonomy (`HARDCODED_SECRET`,
`SQL_INJECTION`, `XSS_DANGEROUS_HTML`, `CODE_INJECTION`, `MISSING_AUTH`),
exit codes for gating.
**Artifacts:** findings JSON, CI annotation, optional follow-up `FIX` task
created from the report.
**Permissions:** read-only by mode; DENY rules on write tools as belt-and-
braces; swapping the default reviewer for a custom one is a code change
today - no pluggable reviewer exists (see [Extension Guide](../EXTENSION_GUIDE.md#what-is-wired-today)).
**Surface:** CI or CLI.

## 8. Docs and knowledge

### 18. Docs-that-match-the-code rewrite

`BUILD` · CLI

**Problem.** Documentation drifts from implementation; nobody notices until
an integrator does.
**Goal.**

```text
Reconcile docs/API.md with the actual routes in apps/api: add missing
endpoints, remove retired ones, fix request/response examples against the
Zod schemas. Only claims verifiable in code may stay; flag unverifiable
ones as [needs-verification].
```

**Context:** route files + schemas (source of truth), workspace instructions
(doc style), `git diff` for evidence.
**Artifacts:** updated doc, claim-by-claim evidence list, verification =
examples still render.
**Permissions:** WRITE→ASK scoped to `docs/**`; plan approval.
**Surface:** CLI or Web.

### 19. Runbook generation with memory recall

`BUILD` · Web

**Problem.** Operational knowledge lives in heads; incidents need it fast.
**Goal.**

```text
Produce docs/RUNBOOK-payments.md from the payment module: startup steps,
health checks, common failure modes (from past task memory if available),
rollback procedure, and on-call checklist links. Cross-check commands
against package.json scripts.
```

**Context:** repo, **project memory** (auto-appended lessons), knowledge
base entries (search), hooks/events history for real incidents.
**Artifacts:** runbook doc; optionally a knowledge entry for reuse.
**Permissions:** plan approval; scope `docs/**`.
**Surface:** Web.

## 9. CI/CD and operations

### 20. Headless verification in the pipeline

`BUILD`/`FIX` · CI

**Problem.** Some pipelines want an agent to attempt the fix, not just fail.
**Goal.**

```text
aiharness test --ci --json --github --project <id>
```

**Context:** CI logs, exit codes gate the job; `--github` posts the outcome
back to the PR.
**Artifacts:** annotations + structured JSON; auto-retry bounded by the
run budget.
**Permissions:** the headless shape — `allowDirectExecution: true` (no
plan gate) with tight `maxToolCallsPerRun` and read-only-ish tool rules;
rate limit: 30 task creations/hour/user.
**Surface:** CI — same lane as the repo's existing `ci.yml` jobs.

### 21. Preview → production deploy with rollback path

`BUILD` · Web or CLI · Persona B

**Problem.** Deploys should be an agent-visible, reversible operation.
**Goal.**

```text
Deploy the current build to preview, run the smoke checks from
verificationPlan, then report readiness for production. Do not touch
production in this task — a second task handles production with an explicit
goal and a rollback checkpoint.
```

**Context:** deploy tools (`deploy.start/status/logs`, environments
`preview|production|staging`), verification plan commands, checkpoints.
**Artifacts:** deployment record, smoke results, rollback-ready checkpoint.
**Permissions:** EXTERNAL-class tools → ASK; environment scoping; note:
deployment provider is preview-grade today — treat as an orchestration
pattern, not a production guarantee.
**Surface:** Web, CLI (`aiharness deploy preview --project <id>`), or SDK deployment API
(create/get/list/cancel/rollback/logs).

## 10. Safety, policy, and recovery

### 22. Prove the safety net: destructive-tool approval

`BUILD` · Web · policy demo

**Problem.** New teams don't trust the agent until they've seen it *stopped*.
**Goal.**

```text
Empty the build cache directory ./dist-cache/** as part of preparing a
clean rebuild. (Run in a workspace where filesystem.delete is ASK.)
```

**Context:** policy tool rules; the approval queue; audit trail.
**Artifacts:** approval request at `WAITING_FOR_TOOL_APPROVAL`, decision
record, `TOOL_DENIED` or approved execution — the full
[rm -rf worked example](guides/permissions-and-approvals.md#worked-example-rm--rf)
is this pattern in detail.
**Permissions:** `filesystem.delete` → `ASK` (default); approve **once** or
**for the task**; `DENY` shows the absolute path.
**Surface:** Web approval card.

### 23. Checkpoint rollback and task retry

`BUILD` · Bridge

**Problem.** A run went sideways; recovery should be one command with an
audit trail.
**Goal.**

```text
Roll back task <id> to its last checkpoint, confirm the file contents
match the checkpoint, then retry the task with the same goal. Report both
checkpoint id and retry run id.
```

**Context:** checkpoints API (`POST /v1/checkpoints/:id/rollback` with
`confirm: true`), events/replay for what happened, audit events.
**Artifacts:** `CHECKPOINT_ROLLED_BACK` audit event, restored files, retry
run; task state machine unchanged by rollback itself.
**Permissions:** rollback is DESTRUCTIVE → ASK/confirm; retry allowed from
terminal-failure states.
**Surface:** Web buttons or SDK (checkpoints list/restore, tasks retry) —
walkthrough: [Example 8](examples/README.md).

## 11. Local and private execution

### 24. Local-model-only run (zero cloud keys)

`BUILD` · Bridge · Persona C

**Problem.** Code must not leave the machine; cloud keys are unwelcome.
**Goal.**

```text
Using the local Ollama provider, plan and implement a .ts utility module
for parsing our log lines, with unit tests. Keep the change inside
src/lib/logparse*.
```

**Context:** Local Bridge to the dev machine, `OLLAMA` or
`OPENAI_COMPATIBLE` provider at `:11434`, model routes for PLANNING +
IMPLEMENTATION (defaults to `qwen2.5:3b` in the E2E script), workspace
instructions.
**Artifacts:** plan + diff + tests — entirely local; usage records priced
at **$0** ([pricing](MODELS_AND_PRICING.md#local-and-free-models)).
**Permissions:** standard plan gate; bridge pairing required; no external
tool verdicts should ever fire (nothing leaves the host).
**Surface:** Bridge — walkthrough: [Example 6](examples/README.md), drive
with `E2E_PROVIDER_BASE=http://host:11434/v1 npm run e2e:agent`.

## 12. Team and governance

### 25. Shared-workspace guardrails for a team

`BUILD`/`PLAN` · Web · Persona D

**Problem.** A workspace owner must let members run agents without ceding
control.
**Goal.** (owner setup, then a member task)

```text
Owner: set workspace instructions (conventions + definition of done),
policy: requirePlanApproval=true, maxSubagents=0, WRITE→ASK rules, and a
task template "Fix lint errors". Member: create a task from the template
against the project, revise the draft plan once, then approve execution.
```

**Context:** versioned workspace instructions, policy snapshot per run,
task templates (`usageCount`), roles (Owner/Member/Viewer), audit events.
**Artifacts:** instruction versions, policy snapshot on the run, template-
instantiated task, full approval history.
**Permissions:** role gates (Viewer cannot create tasks), plan approval
mandatory, revisions audited.
**Surface:** Web — Settings (instructions/policy/templates) + New Task.
Details: [Rules and Instructions](RULES_AND_INSTRUCTIONS.md).

## 13. Prompt-to-app builder

### 26. Scaffold a vertical app from a template

`BUILD` · Web (`/build`) · Persona B · Lovable-style

**Problem.** A whole application, not a task — but still behind plan and
verification gates.
**Goal.** Pick a builder template (each ships a base prompt +
`verificationCommands`), or write your own:

```text
Build an analytics dashboard with Next.js 15 and Recharts. Include:
1) Overview cards with KPIs, 2) Line chart for trends, 3) Bar chart for
comparisons, 4) Data table with sorting and filtering, 5) Date range
selector, 6) Dark mode toggle. Use Tailwind CSS.
```

**Shipped templates (10):**

| Template | Verification |
|---|---|
| Blank Next.js App / Blank Vite React App | `npm run build` |
| SaaS Starter (auth, dashboards, billing stub, multi-tenant) | `typecheck` + `build` |
| Analytics Dashboard · Landing Page · E-Commerce Store · Admin Panel | `npm run build` |
| Full-Stack App (Prisma CRUD + auth) | `typecheck` + `build` |
| REST API Service (Fastify + Zod + rate limits + health) | `typecheck` + `build` |
| AI App | `npm run build` |

**Context:** project template scaffold, workspace instructions, builder
project templates (`blank-nextjs`, `saas-starter`, …), component templates.
**Artifacts:** generated project, build verification, iterated variants
(`/v1/builder/iterate`).
**Permissions:** plan approval gates the scaffold; generated code faces the
same review/security gates as any task.
**Surface:** Web `/build` (prompt-to-app flow).

---

## Mode and surface quick reference

**Mode by intent:**

| You want… | Mode |
|---|---|
| Ship a change | `BUILD` |
| Decide first, write later | `PLAN` |
| An answer, no plan | `ASK` |
| Opinions on existing changes | `REVIEW` |
| Repair a defect | `FIX` |

**Surface by situation:**

| Situation | Surface |
|---|---|
| Interactive work, approvals by click | Web |
| Local dev loop, scripting | CLI (`build/run/ask/plan/fix/…`) |
| Embedding in your own product | SDK (`AiHarnessClient`) |
| PR gating, scheduled jobs | CI (`--ci --json --github`, exit 0/1) |
| Code that must stay on your machine | Bridge (+ local provider) |

**Effort guards (defaults):** plan approval on · 50 tool calls/run ·
30 min/run · 3 replans · 30 task creations/hour/user — all tunable via
[policy](RULES_AND_INSTRUCTIONS.md#tier-4--policy-enforcement-never-prompted).

## Making an entry yours

1. **Copy the goal**, then replace the specifics with yours — keep the
   done-criteria and the stop conditions (see
   [Prompt Guide §5](PROMPT_GUIDE.md#5-prompt-library)).
2. **Add constraints** for scope (`only X/**`) and verification commands.
3. **Save it as a task template** (Settings → Task Templates) so the team
   reuses it — `POST /v1/workspaces/:id/task-templates`, goal ≤5,000 chars.
4. **Pick the mode** — when in doubt, `PLAN` first; it cannot write.
5. **Tighten policy** if the workflow should be impossible rather than
   merely discouraged.

## Related reading

- [Example Gallery](examples/README.md) — 8 deep, step-by-step walkthroughs
- [Prompt Guide](PROMPT_GUIDE.md) — techniques behind every goal above
- [Rules and Instructions](RULES_AND_INSTRUCTIONS.md) — the four tiers
- [Permissions & Approvals](guides/permissions-and-approvals.md) — verdicts
  and approvals used by the entries above
- [CLI Guide](../CLI_GUIDE.md) · [SDK Guide](../SDK_GUIDE.md) ·
  [CI examples](../.github/workflows/ci.yml)
- [Benchmarks](BENCHMARKS.md) — the scenario suite exercises entries 2, 4, 7,
  and 12 as measurable harness scenarios
