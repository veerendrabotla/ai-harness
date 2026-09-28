# Core Concepts

The mental model behind AI Harness. Read this once and every surface — web app, CLI, SDK, agent — makes sense.

Deep reference: [Agent Runtime](AGENT_RUNTIME.md) · [App Flow](APP_FLOW.md) · [Backend Structure](BACKEND_STRUCTURE.md)

---

## 1. The control loop

AI Harness never treats model output as executable authority. Every model-produced action follows one pipeline:

```
Model Proposal → Schema Validation → Permission Evaluation → Approval if Required
      → Tool Execution → Observation → State Transition
```

The model *proposes*; the platform *decides*. This is the single most important idea in the system.

---

## 2. Tasks and runs

- A **task** is a unit of work the user creates (a goal plus constraints) in a project.
- A **run** is one execution attempt of a task. **One active run per task, ever** — concurrency is enforced at the queue level, so two workers can never double-execute the same task.
- A run carries a **policy snapshot**: the instruction/policy versions in force when it started. Changing policy later never retroactively reinterprets historical runs.

### Run states

| State | Meaning |
|---|---|
| `QUEUED` | Accepted, waiting for a worker |
| `INITIALIZING` | Loading task, project, instructions, policy, model config |
| `UNDERSTANDING` | Normalizing the objective (outcome, constraints, deliverables, risks) |
| `GATHERING_CONTEXT` | Read-only tools + Context Engine build the bounded context |
| `PLANNING` | Producing the structured plan |
| `WAITING_FOR_APPROVAL` | Plan parked for human approval (when policy requires it) |
| `EXECUTING` | Carrying out plan steps |
| `WAITING_FOR_TOOL_APPROVAL` | A tool verdict of `ASK` created an approval request |
| `OBSERVING` | Processing tool results |
| `REPLANNING` | A failure or denial triggered a new plan |
| `VERIFYING` | Running the plan's verification steps |
| `REVIEWING` | Optional read-only reviewer stage |
| `COMPLETED` · `FAILED` · `CANCELLED` | Terminal states |
| `INTERRUPTED` | Resumable only by explicit retry/resume logic |

---

## 3. Planning protocol

Planning is a six-step protocol, not a single prompt:

1. **Initialize** — load task, project, instructions, policy, health, model config.
2. **Understand** — normalize the objective into outcome / constraints / deliverables / risks.
3. **Gather context** — read-only tools plus the [Context Engine](guides/context-and-memory.md).
4. **Generate plan** — required fields: analysis, explicitly identified assumptions, affected files, ordered steps, risk list, verification plan.
5. **Validate** — the runtime checks required fields exist, references resolve to real project context, and **no write action occurred during planning**.
6. **Approve** — if policy requires it: `PLANNING → WAITING_FOR_APPROVAL`.

Plans are visible in the UI and over the API; approval or rejection is an ordinary [permission event](guides/permissions-and-approvals.md).

---

## 4. Execution loop and its bounds

```
while run is active:
    load next plan step
    if cancellation requested: cancel safely; stop
    if checkpoint required and not created: create checkpoint
    permission = evaluate(action)
    DENY  → emit denial; replan or fail
    ASK   → create approval; wait
    ALLOW → execute tool with timeout → observe
    failed + recovery permitted → replan; else fail
```

Runs are never unbounded. Each run has maximums for: wall-clock duration, model invocations, tool calls, replans, and (if configured) provider budget.

---

## 5. Permissions and approvals

Every tool call resolves through the **Permission Engine** before the Tool Harness runs anything:

- **ALLOW** — executes immediately.
- **ASK** — creates an expiring approval request; a human decides. Approval scopes are `ONCE` (this call) or `TASK` (this task).
- **DENY** — absolute. The runtime cannot generate a broader scope than workspace policy allows.

The pipeline, policy configuration, and the worked `rm -rf` example are in [Permissions & Approvals](guides/permissions-and-approvals.md).

---

## 6. Checkpoints and rollback

Checkpoints are created:

- before the first filesystem write,
- before any destructive action,
- or manually by the user.

A checkpoint stores a **state reference** (for git projects, a dedicated harness checkpoint created by the bridge — the portable pattern is a stash-based snapshot). Rollback is explicit: user requests → scope displayed → user confirms → Tool Harness rolls back → result verified → event recorded.

**External side effects are explicitly not assumed reversible** — a deployed API call or a pushed commit is outside the checkpoint boundary.

Details: [Permissions & Approvals §5](guides/permissions-and-approvals.md) · runtime spec [§13](AGENT_RUNTIME.md)

---

## 7. Context is bounded, on purpose

The model never sees "the repo". It sees a **budgeted context package** built by the Context Engine under a strict priority order:

1. Security/system instructions → 2. Workspace instructions → 3. Task goal → 4. Current plan → 5. Files required by the current step → 6. Dependency/config files → 7. Recent tool results → 8. Git diff → 9. Prior run summary → 10. Optional MCP resources.

When over budget the engine: **never** drops security instructions or the task goal, summarizes prior history first, removes lowest-priority optional context, and records every omission.

Every context item carries provenance: source type, identifier, inclusion reason, size, redaction status.

Deep dive: [Context & Memory](guides/context-and-memory.md).

---

## 8. Model routing

Model selection is per **stage** — `PLANNING`, `IMPLEMENTATION`, `REVIEW` — in strict decision order:

1. Task manual override → 2. Active workspace route for the stage → 3. Configured fallback route → 4. Fail with `PROVIDER_UNAVAILABLE`.

The runtime records selected route, provider, model, and **fallback reason if used** — so a degraded run is explainable after the fact.

Details: [Models & Providers](guides/models-and-providers.md).

---

## 9. Tools

Every tool in the registry declares: name, input schema, result schema, **risk level**, timeout, output limit, and execution environment. V1 categories:

| Category | Tools |
|---|---|
| Read | `filesystem.list` `filesystem.read` `filesystem.search` `git.status` `git.diff` `terminal.run_readonly` |
| Write | `filesystem.write` `filesystem.create` `filesystem.rename` `filesystem.delete` `terminal.run` |
| Checkpoint | `checkpoint.create` `checkpoint.rollback` |
| Integration | `mcp.call` · `http.request` |

Risk level feeds the permission verdict; MCP calls and HTTP requests still pass through the same permission gate — a model never gains network authority merely because an MCP tool exists.

Full reference: [Tool Guide](../TOOL_GUIDE.md).

---

## 10. Verification and review

- **Verification** executes the plan's declared verification steps (tests, lints, `terminal.run` commands, or browser checks when configured) and records structured results.
- **Security scan** — before a run can settle as `COMPLETED`, results are scanned for hardcoded secrets, SQL injection, XSS, code injection, and missing auth (see [Permissions & Approvals §6](guides/permissions-and-approvals.md) for the exact gating condition).
- **Review agent** — an optional, strictly read-only model stage after implementation. It outputs blocking/non-blocking issues and a confidence statement; it **cannot modify files**. Policy flag `blockOnReviewFindings` can make findings blocking.

---

## 11. Events are the source of truth

Every state transition persists an ordered event **before** it fans out:

- Events carry event ID, task ID, run ID, **sequence number**, actor type, timestamp, redacted payload.
- Clients resume after a disconnect by replaying from `afterSequence` — no lost updates, no polling required.
- If publication fails, persistence already happened; recovery is ordered replay.

Practical guide: [Hooks & Events](guides/hooks-and-events.md).

---

## 12. Failure recovery

| Failure | Response |
|---|---|
| Model (transient) | Retry only while retry budget remains |
| Tool | Classify: retryable / non-retryable / permission / environment |
| Context | **Fail closed** if required instructions cannot load |
| Bridge (local) | Interrupt the run, stop new local actions |
| Event publication | Persist-then-publish; clients recover via replay |

Additionally, a sweeper recovers runs stuck in active states too long, and queue/worker behavior guarantees exactly-one execution per task.

---

## 13. Execution environments

A run's tools execute somewhere concrete:

| Environment | Where | Typical use |
|---|---|---|
| **Internal / Docker sandbox** | Container per run, network-none, CPU/memory capped (`SANDBOX_MODE=docker`) | Default for server-side execution |
| **Local Bridge** | User's machine, via the Bridge Gateway (:4010) with device-token WS auth | Real filesystem + git, IDE-adjacent workflows |
| **Cloud pipeline** | Cloud provider execution path with build cache | CI/CD and remote projects |

Local Bridge runs are path-confined; terminal access is allow-listed and read-only by default. Deployment details: [Self-Hosting](guides/self-hosting.md).

---

## 14. Multi-agent boundary

V1 default: **one primary agent plus an optional read-only reviewer.** Delegated child agents (parallel specialists) run as bounded child runs with: parent run ID, role, maximum tool budget, maximum model budget, explicit tool permissions, and an explicit shared context contract. No child agent may create unlimited children, inherit broader permissions than its parent, or approve another agent's action.

---

## Where to go next

- Drive it: [Getting Started](getting-started.md) → [Examples](examples/README.md)
- Automate it: [SDK Guide](../SDK_GUIDE.md) · [Hooks & Events](guides/hooks-and-events.md)
- Harden it: [Permissions & Approvals](guides/permissions-and-approvals.md) · [Security](../SECURITY.md)
