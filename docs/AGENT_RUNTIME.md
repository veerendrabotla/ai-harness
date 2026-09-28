# AI Harness — Agent Runtime Architecture

# 1. PURPOSE

The Agent Runtime is the stateful execution engine that converts a user task into controlled planning, tool execution, observation, verification, and final reporting.

The runtime does not directly trust model output as executable authority.

Every model-produced action follows:

`Model Proposal -> Schema Validation -> Permission Evaluation -> Approval if Required -> Tool Execution -> Observation -> State Transition`.

---

# 2. CORE RUNTIME COMPONENTS

## Task Orchestrator
Owns the run lifecycle and prevents concurrent active runs.

## State Machine
Defines all valid transitions.

## Context Engine
Builds bounded context packages and manifests.

## Model Router
Selects provider/model by stage and policy.

## Provider Adapter
Converts normalized requests into provider-specific SDK/API calls.

## Tool Registry
Declares available tools and schemas.

## Tool Harness
Validates and executes normalized tool requests.

## Permission Engine
Returns ALLOW, ASK, or DENY.

## Approval Coordinator
Creates, expires, and resolves approval requests.

## Checkpoint Manager
Creates and restores project state references.

## Event Publisher
Persists and publishes ordered runtime events.

## Verification Engine
Runs explicit verification steps and records results.

## Review Agent
Optional read-only model stage after implementation.

---

# 3. AGENT RUN INPUT

A run starts with:

```text
RunInput
- taskId
- runId
- workspaceId
- projectId
- userId
- goal
- constraints
- selectedModelMode
- modelOverride
- workspaceInstructionVersion
- policySnapshot
```

The runtime must persist a policy snapshot reference for each run so later policy changes do not ambiguously reinterpret historical execution.

---

# 4. STATE MACHINE

States:
- QUEUED
- INITIALIZING
- UNDERSTANDING
- GATHERING_CONTEXT
- PLANNING
- WAITING_FOR_APPROVAL
- EXECUTING
- WAITING_FOR_TOOL_APPROVAL
- OBSERVING
- REPLANNING
- VERIFYING
- REVIEWING
- COMPLETED
- FAILED
- CANCELLED
- INTERRUPTED

Terminal states:
- COMPLETED
- FAILED
- CANCELLED

INTERRUPTED is resumable only by explicit retry/resume logic.

---

# 5. PLANNING PROTOCOL

## Step 1: Initialize
Load:
- task;
- project;
- instructions;
- policy;
- project health;
- model configuration.

## Step 2: Understand
Create a normalized objective:
- requested outcome;
- explicit constraints;
- required deliverables;
- known risks.

## Step 3: Gather context
Use read-only tools and Context Engine.

## Step 4: Generate plan
Required plan fields:
1. analysis;
2. assumptions explicitly identified;
3. affected files;
4. ordered steps;
5. risk list;
6. verification plan.

## Step 5: Validate plan
Runtime validates:
- required fields exist;
- plan references known project context where applicable;
- no write action occurred during planning.

## Step 6: Approval
If policy requires:
`PLANNING -> WAITING_FOR_APPROVAL`.

---

# 6. EXECUTION LOOP

Pseudocode:

```text
while run is active:
    load next plan step

    if cancellation requested:
        cancel safely
        stop

    determine required action

    if checkpoint required and not created:
        create checkpoint

    permission = evaluate(action)

    if permission == DENY:
        emit denial
        replan or fail
        continue

    if permission == ASK:
        create approval
        wait
        continue

    execute tool with timeout

    observe result

    if result succeeded:
        continue to next step

    if result failed and recovery is permitted:
        replan

    else:
        fail run
```

The runtime must never loop indefinitely. Each run is bounded by:
- maximum wall-clock duration;
- maximum model invocations;
- maximum tool calls;
- maximum replans;
- provider budget if configured.

---

# 7. NORMALIZED MODEL REQUEST

Every provider receives a logically equivalent request:

```text
ModelRequest
- stage
- systemInstructions
- userObjective
- contextItems
- toolDefinitions
- priorRunSummary
- responseSchema
- maxOutputBudget
```

Provider-specific adapters may transform format, but may not remove required policy instructions.

---

# 8. PROVIDER ADAPTER INTERFACE

```text
interface ModelAdapter {
  providerType: ProviderType

  healthCheck(connection): Promise<HealthResult>

  generate(request): Promise<ModelResponse>

  stream(request, onEvent): Promise<ModelResponse>
}
```

ModelResponse contains:
- text output;
- structured plan if planning;
- normalized tool calls;
- usage metadata;
- finish reason;
- provider request identifier.

---

# 9. MODEL ROUTING

Routing stages:
- PLANNING
- IMPLEMENTATION
- REVIEW

Decision order:
1. Task manual override.
2. Active workspace route for stage.
3. Configured fallback route.
4. Fail with `PROVIDER_UNAVAILABLE`.

The runtime must record:
- selected route;
- provider;
- model;
- fallback reason if used.

---

# 10. CONTEXT ASSEMBLY

Priority order:
1. Security and system instructions.
2. Workspace instructions.
3. Task goal and constraints.
4. Current plan.
5. Files directly required by current step.
6. Relevant dependency/configuration files.
7. Recent tool results.
8. Git diff.
9. Prior run summary.
10. Optional MCP resources.

For every item store:
- source type;
- identifier;
- inclusion reason;
- size;
- redaction status.

If over budget:
1. Never remove security/system instructions.
2. Never remove current task goal.
3. Summarize lower-priority prior history first.
4. Remove lowest-priority optional context.
5. Record all omissions.

---

# 11. TOOL REGISTRY

V1 tools:

## Read
- `filesystem.list`
- `filesystem.read`
- `filesystem.search`
- `git.status`
- `git.diff`
- `terminal.run_readonly`

## Write
- `filesystem.write`
- `filesystem.create`
- `filesystem.rename`
- `filesystem.delete`
- `terminal.run`

## Checkpoint
- `checkpoint.create`
- `checkpoint.rollback`

## MCP
- `mcp.call`

## HTTP
- `http.request`

Every tool definition includes:
- name;
- input schema;
- result schema;
- risk level;
- timeout;
- output limit;
- execution environment.

---

# 12. PERMISSION ENGINE

Input:
- workspace policy snapshot;
- task state;
- tool name;
- normalized action;
- risk level;
- approval history.

Output:
- ALLOW;
- ASK;
- DENY.

Approval scopes:
- ONCE.
- TASK.

The runtime cannot generate a broader scope than the workspace policy allows.

---

# 13. CHECKPOINT SYSTEM

Checkpoint triggers:
- before first filesystem write;
- before destructive action;
- manually by user.

Checkpoint contains a state reference, not necessarily a full database copy.

Local Git project strategy:
- Prefer a dedicated harness checkpoint reference created by the bridge.
- If working tree state prevents safe checkpoint creation, stop and require user resolution.

Rollback:
1. User requests rollback.
2. System displays affected scope.
3. User confirms.
4. Tool Harness invokes rollback.
5. Result is verified.
6. Event is recorded.

External side effects are explicitly not assumed reversible.

---

# 14. MCP INTEGRATION

MCP calls are normalized into:
- server ID;
- tool name;
- validated arguments.

Execution:
`Agent -> Tool Harness -> Permission Engine -> MCP Proxy -> Server`.

The model never receives direct network authority merely because an MCP tool exists.

---

# 15. OPTIONAL REVIEW AGENT

The review stage is read-only.

Inputs:
- approved task goal;
- implementation summary;
- changed files/diff;
- verification results.

Output:
- blocking issue list;
- non-blocking issue list;
- confidence statement.

The review agent cannot modify files.

---

# 16. FAILURE RECOVERY

## Model failure
Retry only when:
- error is transient;
- retry budget remains.

## Tool failure
Observe result, classify:
- retryable;
- non-retryable;
- permission-related;
- environment-related.

## Context failure
Fail closed when required instructions cannot be loaded.

## Bridge failure
Interrupt local run and stop new local actions.

## Event publication failure
Persist event before publication; client can recover through ordered event replay.

---

# 17. EVENT SYSTEM

Event examples:
- RUN_STARTED
- CONTEXT_BUILT
- MODEL_ROUTE_SELECTED
- PLAN_CREATED
- PLAN_APPROVED
- CHECKPOINT_CREATED
- TOOL_REQUESTED
- TOOL_APPROVED
- TOOL_DENIED
- TOOL_STARTED
- TOOL_COMPLETED
- TOOL_FAILED
- REPLAN_STARTED
- VERIFICATION_STARTED
- VERIFICATION_COMPLETED
- REVIEW_COMPLETED
- RUN_COMPLETED
- RUN_FAILED
- RUN_CANCELLED
- RUN_INTERRUPTED

Every event has:
- event ID;
- task ID;
- run ID;
- sequence number;
- actor type;
- timestamp;
- redacted payload.

---

# 18. MULTI-AGENT BOUNDARY

V1 default:
- one primary agent;
- optional reviewer agent.

Future delegated agents must be represented as bounded child runs with:
- parent run ID;
- role;
- maximum tool budget;
- maximum model budget;
- explicit tool permissions;
- explicit shared context contract.

No child agent may:
- create unlimited children;
- inherit permissions broader than its parent;
- approve another agent's action.
