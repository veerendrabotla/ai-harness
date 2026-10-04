# AI Harness — Navigation and Logic Flow

# 1. ENTRY POINTS

1. `/` — public landing route.
2. `/login` — authentication entry.
3. `/signup` — account creation.
4. `/onboarding` — first authenticated setup.
5. `/dashboard` — authenticated default entry.
6. Deep link to `/workspaces/:workspaceId`.
7. Deep link to `/tasks/:taskId`.
8. Local Bridge pairing link.
9. Provider connection callback route.

If an entry point requires authentication and no valid session exists:
`Requested Route -> Session Check -> /login -> Successful Login -> Original Requested Route`.

---

# 2. PAGE INVENTORY

## Public
- `/`
- `/login`
- `/signup`
- `/forgot-password`
- `/reset-password`

## Authenticated account
- `/onboarding`
- `/dashboard`
- `/settings/account`
- `/settings/security`
- `/settings/preferences`
- `/settings/providers`
- `/settings/bridges`

## Workspace
- `/workspaces`
- `/workspaces/new`
- `/workspaces/:workspaceId`
- `/workspaces/:workspaceId/projects`
- `/workspaces/:workspaceId/tasks`
- `/workspaces/:workspaceId/activity`
- `/workspaces/:workspaceId/changes`
- `/workspaces/:workspaceId/git`
- `/workspaces/:workspaceId/context`
- `/workspaces/:workspaceId/mcp`
- `/workspaces/:workspaceId/members`
- `/workspaces/:workspaceId/settings`
- `/workspaces/:workspaceId/policies`
- `/workspaces/:workspaceId/instructions`

## Task
- `/tasks`
- `/tasks/:taskId`
- `/tasks/:taskId/plan`
- `/tasks/:taskId/activity`
- `/tasks/:taskId/context`
- `/tasks/:taskId/changes`
- `/tasks/:taskId/verification`
- `/tasks/:taskId/approvals`

## Models and MCP
- `/models`
- `/models/providers`
- `/models/routing`
- `/mcp`
- `/mcp/servers/new`
- `/mcp/servers/:serverId`

## Local Bridge
- `/bridges`
- `/bridges/new`
- `/bridges/:bridgeId`

---

# 3. GLOBAL NAVIGATION RULES

1. Unauthenticated users cannot access authenticated routes.
2. Workspace routes require workspace membership.
3. Viewer users cannot navigate into execution forms that create runnable tasks.
4. Owner-only settings show an authorization error if accessed directly by a non-owner.
5. Browser back navigation never changes task state.
6. Navigation away from an active task does not cancel the task.
7. Closing the PWA does not cancel a server-side task.
8. The client reconnects to realtime events when reopened.

---

# 4. FIRST-TIME USER FLOW

1. User opens `/`.
2. User selects `Create Account`.
3. System navigates to `/signup`.
4. User submits email, password, and display name.
5. System validates input.
6. On success, account and session are created.
7. System navigates to `/onboarding`.
8. Onboarding asks the user to choose one first action:
   - Connect a model provider.
   - Create a workspace.
   - Pair a Local Bridge.
9. User can skip provider connection.
10. User can skip Local Bridge pairing.
11. User must create or join a workspace before creating a task.
12. Onboarding completion navigates to `/dashboard`.

---

# 5. WORKSPACE CREATION FLOW

1. User selects `New Workspace`.
2. System opens `/workspaces/new`.
3. User enters workspace name and optional description.
4. User selects execution mode:
   - `CLOUD`
   - `LOCAL_CONNECTED`
   - `HYBRID`
5. User selects initial project connection method:
   - Cloud project/repository.
   - Registered Local Bridge project root.
   - Create workspace without a project and add one later.
6. System validates role and connection availability.
7. User defines initial instructions.
8. System creates workspace.
9. System creates default policy.
10. System assigns creator as `OWNER`.
11. System navigates to `/workspaces/:workspaceId`.

---

# 6. PRIMARY TASK FLOW — PLAN THEN EXECUTE

1. User opens a workspace.
2. User selects a project root.
3. User selects `New Task`.
4. System opens task creation form.
5. User enters:
   - Goal.
   - Optional constraints.
   - Model selection mode.
   - Optional model override.
6. System validates workspace status and project availability.
7. System creates task in `QUEUED`.
8. Agent Runtime creates run.
9. Task enters `INITIALIZING`.
10. Runtime loads workspace instructions and policy.
11. Task enters `UNDERSTANDING`.
12. Runtime requests read-only context.
13. Task enters `GATHERING_CONTEXT`.
14. Context Engine creates context manifest.
15. Task enters `PLANNING`.
16. Runtime invokes planning model.
17. Runtime produces structured plan.
18. If policy requires approval, task enters `WAITING_FOR_APPROVAL`.
19. User views plan.
20. User chooses one:
   - Approve.
   - Request revision.
   - Reject.
21. If approved, approved plan version is recorded.
22. Task enters `EXECUTING`.
23. Before configured write phase, checkpoint is created.
24. Runtime selects next plan step.
25. Runtime requests required tool permission.
26. Permission Engine returns:
   - `ALLOW` -> execute.
   - `ASK` -> wait for approval.
   - `DENY` -> record denial and replan/fail.
27. Tool executes.
28. Result enters activity stream.
29. Runtime observes result.
30. Runtime continues, replans, waits, or fails.
31. After implementation, task enters `VERIFYING`.
32. Verification commands execute under policy.
33. Optional reviewer model analyzes changes.
34. Task enters `REVIEWING`.
35. Final result is produced.
36. Task enters `COMPLETED` or `FAILED`.
37. User can inspect activity, context, changes, verification, and checkpoint.

---

# 7. PLAN REVISION FLOW

1. Task is `WAITING_FOR_APPROVAL`.
2. User selects `Request Revision`.
3. User enters revision instruction.
4. System records instruction.
5. Task returns to `PLANNING`.
6. Runtime receives previous plan and revision instruction.
7. New plan version is generated.
8. Previous plan remains immutable in history.
9. Task returns to `WAITING_FOR_APPROVAL`.

---

# 8. DIRECT EXECUTION FLOW

Direct execution is allowed only when workspace policy explicitly permits it.

1. User creates task.
2. User selects `Execute Without Plan Approval`.
3. System checks policy.
4. If not permitted, request is rejected.
5. If permitted, task may perform context gathering and create an internal plan.
6. Write-capable tools still pass through the Permission Engine.
7. Execution continues normally.

---

# 9. TOOL APPROVAL FLOW

1. Runtime requests a tool action.
2. Permission Engine evaluates workspace policy, task scope, tool risk, and existing approvals.
3. If result is `ASK`:
   - Tool call is not executed.
   - Approval record is created.
   - Task enters `WAITING_FOR_TOOL_APPROVAL`.
4. User receives realtime approval event.
5. User views:
   - Tool name.
   - Action summary.
   - Risk level.
   - Scope.
6. User chooses:
   - Approve once.
   - Approve for current task when policy allows.
   - Deny.
7. On approval, runtime retries the pending action.
8. On denial, denial is recorded.
9. Runtime replans or task fails according to agent state and policy.

---

# 10. LOCAL BRIDGE PAIRING FLOW

1. User opens `/bridges/new`.
2. System displays a pairing token/URL.
3. User runs the Local Bridge installer/application.
4. Local Bridge submits pairing request using the pairing token.
5. Backend verifies token and authenticated account.
6. User sees pending bridge registration.
7. User confirms bridge name.
8. Bridge receives registration credentials.
9. Bridge reports capabilities.
10. User registers one or more allowed project roots.
11. Each project root is canonicalized by the bridge.
12. Backend records metadata, never relying on the browser to enforce path boundaries.
13. Bridge status becomes `CONNECTED`.
14. Workspace can select the bridge and project root.

If the bridge disconnects:
`CONNECTED -> DEGRADED -> DISCONNECTED`.

Tasks requiring the bridge:
`EXECUTING -> INTERRUPTED` if execution cannot safely continue.

---

# 11. MODEL PROVIDER FLOW

1. User opens `/models/providers`.
2. User selects provider type.
3. User enters credential.
4. Client submits credential over TLS.
5. Backend encrypts and stores credential.
6. System runs a connection test.
7. User selects one or more available models.
8. Provider connection becomes `ACTIVE`.
9. User can configure routing rules.

If test fails:
`PENDING -> ERROR`.

The credential remains encrypted; it is not returned in response payloads.

---

# 12. MCP FLOW

1. User opens `/mcp`.
2. User selects `Add Server`.
3. User enters server configuration.
4. System validates configuration.
5. Server is registered as `DISABLED`.
6. User explicitly enables it for a workspace.
7. System performs tool discovery.
8. Discovered tools are stored as metadata.
9. Agent can request MCP tools only through Tool Harness.
10. Permission Engine evaluates every call.

---

# 13. ROLE-BASED FLOWS

## Individual User / Owner
Can create workspaces, configure providers, pair bridges, create tasks, approve permitted actions, manage members, and configure policies.

## Member
1. Opens assigned workspace.
2. Creates task if workspace policy grants execution.
3. Uses workspace providers and project roots granted to the workspace.
4. Cannot change owner-only policy.
5. Cannot expose owner credentials.

## Viewer
1. Opens assigned workspace.
2. Views tasks and activity.
3. Cannot create executable task.
4. Cannot approve destructive action.
5. Cannot modify workspace settings.

## System Administrator
No normal workspace navigation is used for user task execution. Administrative operations remain separate from decrypted secrets and active agent tool execution.

---

# 14. CONDITIONAL FLOWS

## Not logged in
Protected route -> Login -> Authenticate -> Return to requested route.

## Workspace archived
Create task -> Reject with `WORKSPACE_ARCHIVED`.
Existing non-terminal task -> Cancel scheduling of new runs.

## Project unavailable
Create task -> Project health check -> Reject execution -> Show reconnect action.

## Provider unavailable
Model invocation -> Provider failure -> Check configured fallback -> Use fallback or fail stage.

## Approval expired
Pending approval -> Expiration -> Pending action invalidated -> Run resumes via `continue-after-tool-decision` -> Treat as denial (replan) -> New approval required.

## Data missing
Required entity lookup -> Not found -> Return `404` -> No fallback to another workspace/entity.

## Realtime connection lost
Client shows reconnecting indicator -> Reconnect -> Request events after last confirmed sequence -> Deduplicate by event ID.

## Concurrent user file changes
Before write -> Compare expected state -> Drift detected -> Stop write -> Create conflict event -> Re-read/replan or require user action.

---

# 15. TASK STATE TRANSITIONS

Allowed lifecycle:

`IDLE` is not persisted for a created task; it is a runtime readiness concept.

`QUEUED -> INITIALIZING`
`INITIALIZING -> UNDERSTANDING | FAILED | CANCELLED`
`UNDERSTANDING -> GATHERING_CONTEXT | FAILED | CANCELLED`
`GATHERING_CONTEXT -> PLANNING | FAILED | CANCELLED`
`PLANNING -> WAITING_FOR_APPROVAL | EXECUTING | FAILED | CANCELLED`
`WAITING_FOR_APPROVAL -> PLANNING | EXECUTING | CANCELLED`
`EXECUTING -> WAITING_FOR_TOOL_APPROVAL | OBSERVING | REPLANNING | VERIFYING | FAILED | CANCELLED | INTERRUPTED`
`WAITING_FOR_TOOL_APPROVAL -> EXECUTING | REPLANNING | FAILED | CANCELLED`
`OBSERVING -> EXECUTING | REPLANNING | VERIFYING | FAILED | CANCELLED`
`REPLANNING -> EXECUTING | WAITING_FOR_APPROVAL | FAILED | CANCELLED`
`VERIFYING -> REVIEWING | REPLANNING | COMPLETED | FAILED | CANCELLED`
`REVIEWING -> COMPLETED | FAILED | CANCELLED`
`INTERRUPTED -> QUEUED | CANCELLED`
`FAILED`, `COMPLETED`, and `CANCELLED` are terminal for a run.

A retry creates a new run with a new run ID.

---

# 16. FORBIDDEN FLOWS

The system must never:
1. Execute a denied tool action.
2. Bypass a required approval.
3. Access a local path outside a registered root.
4. Use a provider credential from another unauthorized user.
5. Send a secret to a model when policy requires redaction.
6. Continue scheduling new tools after cancellation acknowledgement.
7. Mark failed verification as successful.
8. Silently switch to an unconfigured model provider.
9. Let an agent approve its own tool request.
10. Modify project files during Plan Mode.
11. Let browser navigation change task execution state.
12. Execute two active runs for the same task concurrently.
13. Treat an interrupted Local Bridge call as successful.
14. Automatically push to a remote Git repository in V1.

---

# 17. ROUTE STRUCTURE

```text
/
├── login
├── signup
├── forgot-password
├── reset-password
├── onboarding
├── dashboard
├── workspaces
│   ├── new
│   └── :workspaceId
│       ├── projects
│       ├── tasks
│       ├── activity
│       ├── changes
│       ├── git
│       ├── context
│       ├── mcp
│       ├── members
│       ├── policies
│       ├── instructions
│       └── settings
├── tasks
│   └── :taskId
│       ├── plan
│       ├── activity
│       ├── context
│       ├── changes
│       ├── verification
│       └── approvals
├── schedules
├── models
│   ├── providers
│   └── routing
├── mcp
│   ├── servers
│   │   └── new
│   └── servers/:serverId
├── bridges
│   ├── new
│   └── :bridgeId
└── settings
    ├── account
    ├── security
    ├── preferences
    ├── providers
    └── bridges
```

# 18. SCHEDULED TASKS FLOW

Scheduled tasks turn a goal into a recurring (or rapid-interval) agent run without a human clicking "Create task".

1. User opens `/schedules` and selects **New schedule**.
2. User picks workspace + project, enters name and goal, and chooses a cadence:
   - `EVERY_MINUTES` — every N minutes (N ≥ 1)
   - `HOURLY` — at minute M of every hour
   - `DAILY` — at HH:MM every day
   - `WEEKLY` — at HH:MM on a given weekday
   All cadences are UTC. The API computes `nextRunAt` and stores the row in `task_schedules`.
3. The worker's 30-second sweep finds enabled schedules with `nextRunAt <= now`.
4. The sweep atomically claims each schedule (conditional update advancing `nextRunAt`) so
   concurrent workers can never double-fire it.
5. Overlap guard: if the previously fired task is still non-terminal, this cycle is skipped
   (the advanced `nextRunAt` still prevents re-fire spam).
6. The sweep creates a task in `QUEUED` exactly like `POST /v1/tasks` (state persisted first),
   emits `RUN_STARTED` (actor `SYSTEM`, note `scheduled task queued`), and enqueues the
   `start` job on the task-lifecycle queue.
7. The task proceeds through the normal pipeline — planning, approval gates, execution,
   verification — and completion/failure triggers the usual in-app + email notifications.
8. `lastRunAt` / `lastTaskId` are recorded on the schedule so `/schedules` can link to the
   most recent run.
9. Pausing (`enabled=false`) stops future fires; re-enabling recomputes `nextRunAt` so an
   overdue schedule never bursts. Deleting removes the row (completed tasks are untouched).

Guard rails: a schedule whose project is no longer `AVAILABLE` is skipped with a warning;
an invalid persisted cadence is logged and skipped; a failed enqueue leaves the task
`QUEUED` for the worker's orphan sweeper to recover.
