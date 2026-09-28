# Context and Memory

How AI Harness builds a bounded model prompt, ranks what goes into it, defends against
prompt injection, and carries project memory between runs.

Every number, identifier, and endpoint below is copied from source. Primary references:

- [AGENT_RUNTIME.md §10](../AGENT_RUNTIME.md) — context assembly contract
- `backend/packages/context-engine/src/engine.ts` — budgets, priorities, compaction
- `backend/packages/context-engine/src/agentic-search.ts` — search plan / surgical block
- `backend/packages/shared/src/prompt-defense.ts` — fencing
- `backend/packages/agent-runtime/src/orchestrator.ts` — repo map, context persistence
- `backend/packages/agent-runtime/src/memory-aware-orchestrator.ts` — memory wrapper

## Why context is bounded

Context is assembled once per run by `assembleContext()` (`backend/packages/context-engine/src/engine.ts:88`)
into a deterministic, budgeted package. The budget is measured in **bytes, not tokens**:

| Constant | Value | Location |
|---|---|---|
| `DEFAULT_BUDGET_BYTES` | `120_000` UTF-8 bytes | `engine.ts:70` |
| Override | `AssembleInput.budgetBytes` (optional) | `engine.ts:49` |
| Token estimate | `estimateTokens(bytes) = ceil(bytes / 4)` | `engine.ts:291` |

Assembly works in three steps:

1. **Collect candidates.** Each item carries `sourceType`, `identifier`,
   `inclusionReason`, and `content`. `toItem` records `sizeBytes` from the raw UTF-8
   content, runs `redactText()` on it, and marks `redactionStatus` as `CLEAN` or
   `REDACTED` (`engine.ts:76-86`). Measurement and packing therefore use the
   un-redacted size — redaction can only shrink the rendered prompt, never the budget
   accounting.
2. **Sort ascending by rank** (1 = highest priority), then **pack until the byte budget
   is exhausted** (`engine.ts:204-224`).
3. **Record omissions.** Any non-mandatory item that does not fit is pushed to
   `manifest.omitted` with `redactionStatus: "OMITTED"` instead of being silently
   dropped (`engine.ts:213-219`).

Items with `rank <= CONTEXT_PRIORITY.TASK_GOAL` (rank ≤ 3) are **mandatory**: they are
included even if they alone exceed the budget (`engine.ts:211`). Verified by
`engine.test.ts`, which asserts mandatory items survive an absurdly small
`budgetBytes: 50` and may exceed `budgetBytes + 500`.

The result is an `AssembledContext`:

- `manifest` — `ContextManifestDto` with `items`, `omitted`, `budgetBytes`, `usedBytes`
- `promptText` — the final string sent to the model

The orchestrator persists the manifest on `context_packages` with
`estimatedTokens = estimateTokens(usedBytes)` and publishes a `CONTEXT_BUILT` event
carrying `itemCount`, `omittedCount`, `usedBytes`, `estimatedTokens`
(`backend/packages/agent-runtime/src/orchestrator.ts:1677-1696`). The task detail UI
renders `usedBytes/budgetBytes` directly (`frontend/src/app/(app)/tasks/[taskId]/page.tsx:465`).

There is no per-run token budget in this path — a single byte budget applies to the
whole assembled package, and overruns are handled by omission, not by summarization
(see [Compaction](#compaction)).

## Context priorities

`CONTEXT_PRIORITY` is defined verbatim in `engine.ts:11-27`:

| Rank | Source type | Identifier | Contents |
|---|---|---|---|
| 1 | `SYSTEM_INSTRUCTIONS` | `runtime/system` | Security boundary instructions (`RUNTIME_SYSTEM_INSTRUCTIONS`); mandatory |
| 2 | `WORKSPACE_INSTRUCTIONS` | `workspace/instructions` | Latest workspace instruction version, plus mode constraint for REVIEW/ASK; mandatory |
| 3 | `TASK_GOAL` | `task/goal` | `Goal:\n<input.goal>`; mandatory |
| 4 | `CONSTRAINTS` | `task/constraints` | Explicit user constraints (also carries injected project memory, see below) |
| 5 | `PROJECT_ANALYSIS` | `project/intelligence` | Frameworks, languages, scripts, conventions, test setup, entry points, required env vars |
| 6 | `CURRENT_PLAN` | `plan/current` | Approved plan steps guiding execution |
| 7 | `STEP_FILES` | `plan/step-files` | Files listed in the previous plan's `affectedFiles` (planner emits on revision) |
| 8 | `DEPENDENCY_CONFIG` | `project/dependency-config` | Raw `package.json` content when available from `FileVersion.metadata` |
| 8 | `SURGICAL_CONTEXT` | `project/surgical-target` | Agentic-search primary target file block |
| 9 | `RECENT_TOOL_RESULTS` | per tool call `id` | Recent observations from completed tool calls |
| 10 | `GIT_DIFF` | `git/diff` | Current uncommitted changes |
| 11 | `PROJECT_STRUCTURE` | `project/structure` | File tree / directory layout |
| 12 | `REPO_MAP` | `project/repo-map` | Ranked file listing (Aider-style repo map) |
| 13 | `PRIOR_RUN_SUMMARY` | `runs/prior` | Summary of previous runs for the task |
| 14 | `MCP_RESOURCES` | `mcp/resources` | Resources exposed by workspace MCP servers |

All 15 ranks are constructed as candidates: `SYSTEM_INSTRUCTIONS`,
`WORKSPACE_INSTRUCTIONS`, `TASK_GOAL`, `CONSTRAINTS`, `PROJECT_ANALYSIS`,
`CURRENT_PLAN`, `STEP_FILES`, `DEPENDENCY_CONFIG`, `RECENT_TOOL_RESULTS`,
`GIT_DIFF`, `PROJECT_STRUCTURE`, `REPO_MAP`, `SURGICAL_CONTEXT`,
`PRIOR_RUN_SUMMARY`, `MCP_RESOURCES` (`engine.ts:91-261`). The three newest
tiers are conditional: `STEP_FILES` requires a previous plan (revision),
`DEPENDENCY_CONFIG` requires `package.json` content in `FileVersion.metadata`,
and `MCP_RESOURCES` requires connected workspace MCP servers with listed
resources — when the input is absent the tier simply produces no candidate.

Notes that matter when reading the code:

- `SURGICAL_CONTEXT` is tied with `DEPENDENCY_CONFIG` at rank 8. `Array.sort` is
  stable, so `DEPENDENCY_CONFIG` (declared earlier in the candidates array) packs
  first; both sit after instructions, goal, constraints, analysis, and plan, and
  before tool results, diff, structure, and the repo map.
- Candidates whose `sourceType` is not in `CONTEXT_PRIORITY` fall back to rank `50`
  (`engine.ts:83`) and are therefore dropped first.
- Mandatory is defined as `rank <= TASK_GOAL` (3): system instructions, workspace
  instructions, and the goal are included regardless of budget. `CONSTRAINTS` (4) is
  the highest-ranked optional item — it is cut only when the mandatory items alone
  already fill the budget, and successively higher ranks are cut after it.
- Only `SYSTEM_INSTRUCTIONS` is written outside an injection fence in `promptText`
  (`engine.ts:235-241`); everything else is fenced.

The priority list mirrors `AGENT_RUNTIME.md §10`, whose over-budget rules are: never
remove security/system instructions, never remove the task goal, summarize lower-priority
history first, remove lowest-priority optional context, record all omissions.

## Repo map

The repo map is built by `TaskOrchestrator.buildRepoMap()`
(`backend/packages/agent-runtime/src/orchestrator.ts:1701`), labeled
"PageRank-lite ranked".

**Input.** Real file versions, not a guessed tree: `FileVersion` rows for the project,
ordered `createdAt desc`, `take: 2000`, de-duplicated by path
(`orchestrator.ts:1605-1628`). `package.json` and `.env.example` content is read from
`FileVersion.metadata.content` when a bridge stored a preview, and fed to
`analyzeRepository()` from `@ai-harness/repo-intelligence` for `PROJECT_ANALYSIS`.

**Filtering.** Paths containing any of `node_modules`, `.git`, `dist`, `build`, `.next`,
`coverage`, `.turbo`, `vendor`, `__pycache__` are dropped, then the list is capped at
**500 files** (`orchestrator.ts:1702-1706`).

**Scoring** (`orchestrator.ts:1719-1733`) — a single pass over basenames:

```text
score = 1
      + sqrt(basenameRefCount) * 2        # basename appears in other paths (refs > 1)
      + 5 if filename is index|main|app|server|entry|_app|layout.(ts|tsx|js|jsx)
      + 2 if path contains "route" | "controller" | "handler"
      - depth * 0.3                       # deeper files rank lower
      + 1 if base name length >= 8 and contains _ - or camelCase hump
```

The basename reference count approximates Aider's referencer→definer edge without
parsing (`orchestrator.ts:1709-1717`).

**Output** (`orchestrator.ts:1740-1763`):

- header `## Repository Map (PageRank-lite ranked)`
- top 100 scored files, of which the top 40 are printed with scores; `... and N more
  ranked files` if truncated
- the remainder grouped by top-level directory, sorted by group size, max 60 paths
  per group with `... and N more`

The map is handed to `assembleContext` as `repoMap` (`REPO_MAP`, rank 12).

## Agentic search

`backend/packages/context-engine/src/agentic-search.ts` implements a Lovable-style
intent → plan → surgical context flow. The orchestrator runs it whenever file entries
exist (`orchestrator.ts:1653-1661`).

### `generateSearchPlan(goal, fileList, constraints?)`

- Lowercases the goal, tokenizes on `[a-z0-9_\-./]`, drops tokens shorter than 3 chars,
  pure numbers, and a stop-word list that includes `create`, `update`, `change`,
  `modify`, `generate`, `build`, `implement`, `feature`, `function`, `component`
  (`agentic-search.ts:76-88`).
- Keeps order of first occurrence, **max 8 terms**.
- Infers `editType` from goal keywords: `CREATE_FILE`, `DELETE_FILE`, `REFACTOR`,
  `FIX_BUG`, `UPDATE_COMPONENT`, else `GENERAL` (`agentic-search.ts:44-49`).
- Confidence: `0.5` base → `0.7` if a term appears in a file path → `0.85` if the goal
  mentions `src/` or a code extension (`\.tsx?|jsx?|py|go|rs`) (`agentic-search.ts:52-54`).
- Constraint terms are added only when they also appear in the file list.

### `scoreFiles(plan, fileList, { maxResults = 1 })`

Per path, per term: `+10` for a substring match, `+5` for an exact path-segment match
(so `hero` beats `superhero.tsx`), plus `+2` for edit-type-appropriate extensions
(`.tsx|.jsx|.vue|.svelte` for `UPDATE_COMPONENT`, `.ts|.js|.py|.go|.rs` for `FIX_BUG`).
Candidates with score 0 are discarded, sorted descending, and truncated to
`maxResults` — default **1**, i.e. single-target mode (`agentic-search.ts:109-145`).

### `buildSurgicalBlock(plan, target)`

Produces the `SURGICAL_CONTEXT` content: edit type, confidence, search terms, primary
target path with score and matched terms, optional line hint, and the instruction
"Make ONLY the change described in the goal. Focus on the primary target file. Do not
modify unrelated files." With no target it returns a fallback telling the model to use
broad context (`agentic-search.ts:151-171`).

## Compaction

`engine.ts:295-417` exports a Codex-style prune-then-summarize helper:

| Symbol | Value / behavior |
|---|---|
| `COMPACTION_THRESHOLD_RATIO` | `0.6` (`engine.ts:307`) |
| `shouldCompact(usedTokens, modelContextLimit)` | `usedTokens / modelContextLimit >= 0.6` |
| `compactContext(messages, opts)` | `protectTokens` default `40_000`, `budgetTokens` default `4_000` |
| Handoff summary | `[Context Handoff — N earlier messages summarized. Continue from here.]` + sampled lines |

`compactContext` walks messages newest-first until `protectTokens` worth of history is
protected verbatim; everything older becomes a handoff. The handoff keeps the first
meaningful line (the goal), any line matching
`plan|tool|decision|error|approved|rejected|checkpoint|verification`, and the last five
meaningful lines, then truncates to `budgetTokens * 4` chars (`engine.ts:376-417`).
Fence lines (`UNTRUSTED_…`) and separator rules are filtered out of the summary input.

**Status: not wired into the runtime.** A repo-wide search finds no production caller of
`shouldCompact` or `compactContext` — only the definitions and their doc comment
(`engine.ts:304`: `Usage: if (shouldCompact(usedTokens, modelContextLimit)) { compact(...) }`).
The orchestrator persists the assembled package once per stage; it does not yet
re-compact conversation history. Treat these as available primitives, not active
behavior.

## Prompt-injection defenses

Fencing lives in `backend/packages/shared/src/prompt-defense.ts` and is applied by the
context engine itself.

- `makeFence()` returns `UNTRUSTED_` + `randomBytes(6).toString("hex")` — a fresh
  delimiter per call, so a malicious file cannot predict or forge the closing fence.
- `sanitizeUntrusted(text, fence)` neutralizes look-alike closing fences (splits on the
  exact fence token) and HTML-escapes `<…>` tags named `context`, `untrusted`,
  `system`, `assistant`, `user`, `tool` (`prompt-defense.ts:16-25`).
- `fenceUntrusted(label, text)` wraps content as:

```text
<untrusted source="<label>" fence="<UNTRUSTED_hex>">
…sanitized content…
</untrusted>
```

  The label itself is stripped of `"`, `<`, `>`, and newlines.
- In `assembleContext`, only `SYSTEM_INSTRUCTIONS` is emitted unfenced; every other
  included item goes through `fenceUntrusted(identifier, content)`
  (`engine.ts:235-241`). `engine.test.ts` asserts exactly that: system instructions
  first and unfenced, everything else fenced.
- Redaction runs before fencing: `redactText()` replaces secret-shaped values, and each
  manifest item records `redactionStatus` as `CLEAN`, `REDACTED`, or `OMITTED`
  (`engine.ts:82`, `backend/packages/contracts/src/activity.ts:75`).

The compaction summary deliberately skips `UNTRUSTED_` lines so fence markers never
leak into the handoff (`engine.ts:384`).

## Memory

### Components

| Piece | Location |
|---|---|
| `MemoryAwareOrchestrator` | `backend/packages/agent-runtime/src/memory-aware-orchestrator.ts:27` |
| `ProjectMemoryEngine` interface | `backend/packages/project-memory/src/types.ts:56` |
| `PrismaProjectMemoryEngine` (persisted) | `backend/packages/project-memory/src/prisma-engine.ts:15` |
| `InMemoryProjectMemoryEngine` (fallback/tests) | `backend/packages/project-memory/src/engine.ts:16` |
| Wiring | `backend/packages/agent-runtime/src/runtime.ts:91,130` — the runtime builds a `PrismaProjectMemoryEngine` and injects it into the memory wrapper |

The worker's default execution path is memory-aware: `backend/apps/worker/src/worker.ts:151`
calls `runtime.memoryOrchestrator.startRun(...)`, not the bare orchestrator.

### Run flow

`MemoryAwareOrchestrator.startRun()` (`memory-aware-orchestrator.ts:45`):

1. **Feature flag check.** `isMemoryEnabled(workspaceId)` reads
   `FeatureFlag` where `workspaceId_key = { workspaceId, key: "memory_enabled" }`.
   **Missing flag → enabled**; lookup failure → enabled (`memory-aware-orchestrator.ts:216-228`).
   When disabled, the wrapper bypasses itself and calls the underlying orchestrator.
2. **Retrieve.** `memoryEngine.getRelevant(projectId, goal, 20)` and bucket the
   insights by category.
3. **Emit** a `MEMORY_CONTEXT_LOADED` event with the count per category.
4. **Inject.** Hints are appended to `RunInput.constraints` under a
   `PROJECT MEMORY (from previous runs):` header (`memory-aware-orchestrator.ts:135-163`).
   Because `CONSTRAINTS` is rank 4 — the highest-ranked non-mandatory tier — memory
   hints are packed before plan, files, diff, and repo map, and are only omitted when
   the mandatory items (ranks 1-3) already fill the budget.
5. **After a `COMPLETED` run**, goals longer than 100 characters are stored as a
   `lesson_learned` memory (`confidence 0.7`, `source: "agent_observation"`).
   On error, a `recurring_failure` memory is recorded (`confidence 0.8`,
   `source: "error_pattern"`), then the error is rethrown.

### Categories and relevance

Ten categories are defined in `backend/packages/project-memory/src/types.ts:15`:
`architecture_decision`, `coding_convention`, `previous_bug`, `user_preference`,
`deployment_config`, `recurring_failure`, `lesson_learned`, `file_pattern`,
`dependency_note`, `performance_note`. Each memory carries `key`, `value`, `context`,
`confidence` (0-1), `source`, `references[]`, and access counters.

Relevance scoring — the persisted engine the runtime actually uses,
`PrismaProjectMemoryEngine.getRelevant(projectId, context, limit = 20)`
(`backend/packages/project-memory/src/prisma-engine.ts:62-95`):

- keywords = context lowercased, split on whitespace, length > 3, first 10 only
- loads up to 100 memories for the project
- `+0.2` per keyword found in `key + value + context`
- `+confidence * 0.3`
- keep insights with relevance > 0.1 (capped at 1), sort descending, truncate to `limit`
- the first matching keyword becomes the `reason`

The in-memory engine used in tests (`backend/packages/project-memory/src/engine.ts:62-117`)
scores differently: words longer than 2 chars, plus **category boosts** (`recurring_failure
0.25`, `previous_bug 0.2`, `lesson_learned 0.2`, `architecture_decision`/`user_preference`/
`performance_note` 0.15, the rest 0.1) and `confidence * 0.2`; it also bumps
`accessCount`/`lastAccessedAt` on the returned insights. Do not assume category boosts
apply at runtime — they do not, unless `InMemoryProjectMemoryEngine` is injected.

Both engines expose `reinforce()` (the Prisma version increments confidence by 0.05 and
`accessCount`) and `decay(maxAgeDays = 90)` for pruning.

### REST surface

Registered in `backend/apps/api/src/app.ts:274`
(`backend/apps/api/src/modules/projects/projects.memories.ts`):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/projects/:projectId/memories` | List project memories |
| `POST` | `/v1/projects/:projectId/memories` | Create a project memory |
| `PUT` | `/v1/projects/:projectId/memories/:memoryId` | Update a project memory |
| `DELETE` | `/v1/projects/:projectId/memories/:memoryId` | Delete a project memory |

These paths are **not** listed in [API.md](../API.md); they are Swagger-tagged
`project-memory` and visible at `/docs`.

Toggling memory is a workspace feature flag (see `backend/apps/api/src/modules/workspaces/workspaces.feature-flags.ts`,
`GET/POST /v1/workspaces/:workspaceId/feature-flags` and the flag status route in the
same file) — set `key: "memory_enabled"`, `enabled: false` to bypass memory.

## Practical tips

How users actually steer what ends up in the prompt:

1. **Workspace instructions are rank 2.** Keep them short and stable — they are
   mandatory and consume budget before the goal.
   `GET/POST /v1/workspaces/:workspaceId/instructions`
   (`backend/apps/api/src/modules/instructions-policy/instructions-policy.routes.ts:13,44`).
   Versions are ordered; the orchestrator loads the highest `version`
   (`orchestrator.ts:1578-1583`).
2. **Policy controls execution, not context.** `GET/PUT /v1/workspaces/:workspaceId/policy`
   (`instructions-policy.routes.ts:90,113`) sets plan-approval and direct-execution
   behavior; the runtime contract requires a policy snapshot reference per run so later
   edits do not reinterpret historical execution ([AGENT_RUNTIME.md §3](../AGENT_RUNTIME.md)).
   Note: the worker currently passes an empty `policySnapshotId`
   (`backend/apps/worker/src/worker.ts:169`).
3. **Goal and constraints quality pays off twice.** The goal is mandatory rank-3
   content and, together with constraints (rank 4), is the input to
   `generateSearchPlan`. Concrete paths (`src/app/page.tsx`), component names, and code
   extensions raise search confidence from 0.5 to 0.85 and make `scoreFiles` return a
   real target instead of the broad-context fallback.
4. **Constraints are the memory channel.** Anything you put in task constraints is
   concatenated with injected project memory, so keep them terse — they share rank 4,
   the largest non-mandatory block in the prompt. Rank 4 items are packed before every
   other optional tier, so long constraints directly crowd out plan, diff, and repo map.
5. **WATCH the manifest.** `CONTEXT_BUILT` events and `context_packages` rows expose
   `usedBytes`, `budgetBytes`, and `omitted`; a non-empty `omitted` list means the
   model did not see that material.
6. **Modes change instructions, not the budget.** `REVIEW` and `ASK` append a read-only
   `[MODE CONSTRAINT: …]` line to workspace instructions
   (`orchestrator.ts:1584-1591`); they do not add budget or drop tiers.
7. **Disable memory per workspace** with the `memory_enabled` feature flag if you want
   runs to be stateless; there is no per-task switch.
