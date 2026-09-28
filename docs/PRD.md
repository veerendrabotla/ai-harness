# AI Harness — Product Requirements Document

## 1. PRODUCT OVERVIEW

### Product name
**AI Harness**

### Product definition
AI Harness is a PWA-first, model-independent agentic development environment. It provides a unified control plane for AI coding agents to understand software projects, assemble context, create plans, request approval, use controlled tools, modify code, run commands, verify results, and preserve an auditable execution history.

AI Harness is composed of:
1. **PWA Control Plane** — the user-facing application.
2. **Backend Control Plane** — authentication, workspaces, tasks, policies, events, persistence, model routing, and orchestration.
3. **Agent Runtime** — the stateful task execution engine.
4. **Tool Harness** — normalized filesystem, terminal, Git, HTTP, and MCP tool interfaces.
5. **Local Bridge** — an optional installable local service that grants approved access to local workspaces and tools.
6. **Cloud Sandbox** — an optional isolated remote execution environment.

### Problem statement
Existing AI coding products frequently bind users to a single model provider, a single execution environment, or an opaque agent workflow. Users cannot consistently control:
- which model performs which stage of a task;
- what project context is sent to a model;
- which tools an agent may execute;
- when destructive actions require approval;
- how to inspect and revert agent-generated changes;
- how to use the same agent workflow across cloud and local repositories.

AI Harness solves this by separating the **control system** from the **AI model** and by making planning, execution, permissions, context, checkpoints, and verification explicit product entities.

### Target users

#### Persona A — Independent AI-native developer
A developer working alone on one or more repositories who uses multiple AI providers and needs controlled code generation, terminal execution, diffs, and rollback.

#### Persona B — Full-stack application builder
A developer building web or mobile applications with repositories containing frontend, backend, databases, configuration, and deployment files. This user needs agents to work across multiple files without losing project instructions.

#### Persona C — Advanced local-AI developer
A developer running local models or local tools and requiring a browser-accessible control plane that can securely connect to a local machine through the Local Bridge.

#### Persona D — Technical team workspace member
A developer who works inside a shared workspace and must follow repository-level instructions and execution policies defined by a workspace owner.

### Core value proposition
**One controlled harness for many AI models, agents, tools, and execution environments.**

A user can assign a development task, inspect the context and plan, approve execution, observe every meaningful tool action, review generated changes, verify results, and revert to a checkpoint.

---

# 2. PRODUCT PRINCIPLES

1. **Model-independent** — no product feature depends on a single AI provider.
2. **Task-first** — long-running work is represented as a structured task, not only as chat history.
3. **Explicit execution** — the system records state transitions and tool actions.
4. **Policy-controlled** — tools are governed by workspace and task permissions.
5. **Human interruptibility** — users can approve, pause, resume, reject, or cancel execution.
6. **Checkpoint before risk** — reversible checkpoints are created before configured write operations.
7. **Context transparency** — users can inspect the context package sent to a model.
8. **Normalized tools** — providers interact with a provider-independent tool protocol.
9. **Environment portability** — the same workspace model supports cloud, local-connected, and hybrid execution.
10. **No silent privilege escalation** — an agent cannot gain a permission that the current policy has not granted.

---

# 3. V1 PRODUCT BOUNDARY

## Included in V1
- PWA account and authentication.
- Personal and shared workspaces.
- Git repository connection through Git provider integration.
- Local workspace connection through Local Bridge.
- Cloud workspace storage.
- Task creation and lifecycle management.
- Single primary agent per task.
- Optional reviewer sub-agent after implementation.
- Plan mode and execution mode.
- Model provider connections using user-managed API keys.
- OpenAI-compatible provider adapter.
- Anthropic provider adapter.
- Google provider adapter.
- Ollama local provider adapter through Local Bridge.
- Manual model selection.
- Rule-based automatic model routing.
- Filesystem read/write tools.
- Terminal execution tools.
- Git status and diff tools.
- MCP server registry and workspace activation.
- Approval requests.
- Tool permission policies.
- Agent checkpoints and rollback.
- Context inspection.
- Activity stream.
- Diff review.
- Task verification results.
- Realtime task events.

## Explicitly excluded from V1
- Autonomous scheduled agents.
- Fully autonomous production deployment.
- Browser automation that can perform purchases or financial actions.
- Payment processing.
- Public marketplace for agents or prompts.
- Arbitrary plugin code execution inside the PWA.
- Unlimited recursive sub-agent spawning.
- Multi-organization enterprise administration.
- SSO/SAML.
- Fine-tuning or training foundation models.
- Hosting proprietary model weights.
- Native desktop IDE replacement.
- Direct unrestricted access to the user's entire machine.

---

# 4. FEATURES

## F-01: Authentication and Account Management

### Description
Users create and access accounts used to own workspaces, provider connections, tasks, and Local Bridge registrations.

### User story
As a user, I want to sign in securely so that my workspaces and agent history remain associated with my account.

### Acceptance criteria
1. A new user can create an account with email and password.
2. Passwords are never stored in plaintext.
3. An authenticated session is required for protected API routes.
4. A user can sign out and invalidate the active refresh session.
5. A user can request password reset.
6. An unauthenticated user is redirected from protected routes to `/login`.

### Included scope
- Email/password authentication.
- Session refresh.
- Password reset.
- Account profile containing display name and avatar URL.

### OUT OF SCOPE
- Social login.
- Enterprise SSO.
- SAML.
- Hardware security keys.

---

## F-02: Workspace Management

### Description
A workspace is the top-level boundary for repositories, instructions, policies, members, MCP servers, and tasks.

### User story
As a developer, I want separate workspaces for separate projects so that agents use the correct instructions and permissions.

### Acceptance criteria
1. A user can create a workspace with a unique UUID.
2. A workspace has a name, description, owner, execution mode, and lifecycle status.
3. A workspace owner can archive a workspace.
4. Archived workspaces reject new task execution.
5. A workspace can contain one or more project roots.
6. Workspace instructions are versioned.
7. Workspace policy changes are recorded in the audit log.

### Included scope
- Personal workspace.
- Shared workspace.
- Cloud, local-connected, and hybrid execution modes.
- Workspace instructions.
- Workspace policies.
- Archive and restore.

### OUT OF SCOPE
- Nested workspaces.
- Cross-workspace filesystem access.
- Public workspace discovery.

---

## F-03: Project and Repository Connection

### Description
Users connect source code to a workspace through a cloud repository integration or the Local Bridge.

### User story
As a developer, I want an agent to work against my actual project files.

### Acceptance criteria
1. A project root has a stable project ID.
2. A project root records its connection type.
3. The system rejects task execution if the project root is unavailable.
4. Repository metadata includes current branch and Git status when Git is available.
5. Local paths are never sent to another user unless that user is explicitly authorized for the workspace.
6. A disconnected Local Bridge marks dependent project roots unavailable.

### Included scope
- Git repository metadata.
- Local Bridge project registration.
- Cloud project storage metadata.
- Project health status.

### OUT OF SCOPE
- Importing every repository from a provider automatically.
- Acting on multiple unrelated project roots as one filesystem.
- Remote Git push by default.

---

## F-04: Task Creation and Lifecycle

### Description
A task is a persistent agent job with a goal, model selection, context package, plan, approvals, execution events, changes, verification, and final result.

### User story
As a developer, I want AI work to be represented as a trackable task rather than an unstructured chat.

### Acceptance criteria
1. A task belongs to exactly one workspace and one project root.
2. A task cannot enter execution before required approvals are satisfied.
3. Every state transition is persisted.
4. A user can cancel a non-terminal task.
5. A completed task cannot return to execution without creating a new task or explicit retry run.
6. Task activity is visible in chronological order.

### Included scope
- Task creation.
- Status lifecycle.
- Cancellation.
- Retry.
- Final summary.
- Activity stream.

### OUT OF SCOPE
- Cron-based task execution.
- Background tasks after account deletion.
- Hidden task execution.

---

## F-05: Plan Mode

### Description
Plan Mode allows the agent to inspect approved read-only context and tools, then produce a structured implementation plan without modifying project files.

### User story
As a developer, I want to understand what the agent intends to do before it changes my project.

### Acceptance criteria
1. Plan Mode cannot call write-capable tools.
2. The plan contains problem analysis, affected files, ordered steps, risks, and verification steps.
3. The user can approve, reject, or request plan revision.
4. Execution cannot start from a rejected plan.
5. Approval records the approved plan version.

### Included scope
- Repository inspection.
- Read-only terminal commands allowed by policy.
- Structured plan.
- Plan revision.

### OUT OF SCOPE
- File modification.
- Dependency installation.
- Git commit.
- Deployment.

---

## F-06: Execution Mode

### Description
Execution Mode performs the approved plan using normalized tools and policy-controlled permissions.

### User story
As a developer, I want the agent to implement approved work while I can observe and interrupt it.

### Acceptance criteria
1. Execution starts only after the task has an approved plan when the policy requires planning.
2. Every tool request is validated before execution.
3. Every completed tool call records input summary, result summary, timestamps, and status.
4. A user can pause a task between tool calls.
5. A user can cancel a task.
6. A canceled task performs no additional tool call after cancellation is acknowledged.

### Included scope
- Tool execution loop.
- Replanning.
- Pause/resume.
- Cancellation.
- Verification stage.

### OUT OF SCOPE
- Unbounded autonomous execution.
- Ignoring permission denials.
- Continuing after a workspace is archived.

---

## F-07: Model Hub and Provider Connections

### Description
Users connect supported model providers and select models per task or through routing rules.

### User story
As a developer, I want to use the model best suited to my task without changing my workspace workflow.

### Acceptance criteria
1. Provider credentials are encrypted at rest.
2. Provider credentials are never returned by normal read APIs.
3. A task records the provider and model used for each model invocation.
4. A provider connection can be disabled.
5. Disabled provider connections cannot receive new model requests.
6. Provider failures produce a structured task event.

### Included scope
- Anthropic adapter.
- OpenAI adapter.
- Google adapter.
- OpenAI-compatible adapter.
- Ollama adapter through Local Bridge.
- User-managed API keys.
- Model health test.

### OUT OF SCOPE
- Platform-managed billing for model tokens.
- Model training.
- Provider credential sharing between unrelated workspaces.

---

## F-08: Model Routing

### Description
A routing policy selects a model based on task stage and configured rules.

### User story
As a developer, I want a fast model for inspection and a stronger model for implementation without manually switching every request.

### Acceptance criteria
1. Manual model selection overrides automatic routing.
2. Routing rules specify stage, provider connection, model identifier, and fallback behavior.
3. A route decision is recorded in task activity.
4. If the selected provider is unavailable, only configured fallback routes may be used.
5. The system never silently changes to an unconfigured paid provider.

### Included scope
- Planning route.
- Implementation route.
- Review route.
- Fallback route.

### OUT OF SCOPE
- Machine-learning-based automatic routing.
- Automatic purchase of additional model capacity.

---

## F-09: Context Engine

### Description
The Context Engine constructs bounded context packages for model requests.

### User story
As a developer, I want the agent to receive relevant project information without blindly sending the entire repository.

### Acceptance criteria
1. Each context package records its source items.
2. Context items include a reason for inclusion.
3. The system enforces configured size limits.
4. Secret values are redacted unless a specific secret-access approval exists.
5. Users can inspect a context manifest after task execution.
6. Context from one workspace is never used in another workspace unless explicitly exported and imported.

### Included scope
- Workspace instructions.
- Task prompt.
- Repository structure.
- Relevant file excerpts.
- Git diff.
- Tool results.
- Task summary.
- MCP resources.

### OUT OF SCOPE
- Automatic cross-user memory sharing.
- Training provider models on user data.
- Hidden context sources.

---

## F-10: Tool Harness

### Description
The Tool Harness provides a normalized execution interface independent of model-provider tool formats.

### User story
As a developer, I want the same workspace tools to work with different models.

### Acceptance criteria
1. Each tool has a stable tool ID and schema.
2. Tool input is validated before execution.
3. Tool execution is associated with a task.
4. Tool execution is denied if policy does not permit it.
5. Tool results are stored with success, failure, timeout, or canceled status.
6. Providers cannot directly bypass the Tool Harness.

### Included scope
- Filesystem read/list/search/write/delete.
- Terminal command execution.
- Git status/diff/checkpoint/rollback.
- HTTP request tool with policy restrictions.
- MCP tool proxy.

### OUT OF SCOPE
- Arbitrary browser extension APIs.
- Kernel-level machine access.
- Direct model-controlled shell sessions without per-command validation.

---

## F-11: Permission and Approval Engine

### Description
Policies determine whether a requested tool action is automatically allowed, requires approval, or is denied.

### User story
As a developer, I want to control what an agent can do before it affects my project or environment.

### Acceptance criteria
1. Every tool action resolves to `ALLOW`, `ASK`, or `DENY`.
2. `DENY` prevents execution.
3. `ASK` creates an approval request with action summary and risk level.
4. Approval can be granted once or for the current task according to policy.
5. Approval expires when its scope expires.
6. An agent cannot approve its own request.

### Included scope
- Workspace policy.
- Task-level temporary permission.
- Risk levels: read, write, destructive, external.
- Approval history.

### OUT OF SCOPE
- Biometric approval.
- Delegating approval to an AI agent.
- Permanent machine-wide permission.

---

## F-12: Local Bridge

### Description
The Local Bridge is an optional local runtime that exposes explicitly registered project roots and supported local tools to an authenticated PWA session.

### User story
As a developer, I want to use the PWA while allowing approved agent actions on a selected local project.

### Acceptance criteria
1. The bridge requires device registration.
2. The bridge exposes only registered project roots.
3. The bridge rejects paths outside registered roots.
4. The bridge authenticates requests using short-lived credentials.
5. The bridge reports connectivity and version status.
6. Disconnecting the bridge prevents new local tool calls.

### Included scope
- Registered roots.
- Filesystem adapter.
- Terminal adapter.
- Git adapter.
- Ollama adapter.
- Local MCP adapter.

### OUT OF SCOPE
- Full-machine remote desktop access.
- Unrestricted path traversal.
- Silent bridge installation.

---

## F-13: MCP Management

### Description
Users register MCP servers and enable them globally or per workspace.

### User story
As a developer, I want agents to use external capabilities through MCP while retaining workspace-level control.

### Acceptance criteria
1. MCP server configuration belongs to an owner and scope.
2. Workspace activation is explicit.
3. Available tools are discovered and displayed.
4. Every MCP tool call passes through the Permission Engine.
5. A disabled MCP server cannot receive new calls.

### Included scope
- MCP server registry.
- Workspace enablement.
- Tool discovery.
- Tool call proxy.
- Audit events.

### OUT OF SCOPE
- Public MCP marketplace.
- Automatically trusting unknown MCP servers.
- Cross-workspace credential sharing by default.

---

## F-14: Agent Checkpoints and Rollback

### Description
The system records recoverable project checkpoints before configured write phases.

### User story
As a developer, I want to revert agent changes when implementation goes wrong.

### Acceptance criteria
1. A checkpoint has a stable ID and timestamp.
2. A checkpoint records the project state reference required for rollback.
3. Rollback requires explicit user confirmation when it overwrites current changes.
4. Rollback activity is recorded.
5. A failed rollback produces a structured error without pretending success.

### Included scope
- Pre-execution checkpoint.
- Manual checkpoint.
- Task-associated rollback.

### OUT OF SCOPE
- Guaranteed rollback of external side effects.
- Rollback of already deployed production systems.
- Infinite checkpoint retention.

---

## F-15: Diff and Change Review

### Description
Users inspect changes produced during a task.

### User story
As a developer, I want to know exactly what the agent changed.

### Acceptance criteria
1. Changed files are grouped by task run.
2. Users can inspect unified diffs.
3. Each file change identifies create, modify, rename, or delete when available.
4. The system displays verification status separately from change status.
5. Users can trigger rollback from a checkpoint.

### Included scope
- File list.
- Unified diff.
- Change summary.
- Checkpoint reference.

### OUT OF SCOPE
- Full visual merge editor.
- Simultaneous collaborative code editing.

---

## F-16: Verification and Review

### Description
After implementation, the agent runs configured verification steps and may invoke a reviewer model.

### User story
As a developer, I want evidence that the agent checked its work.

### Acceptance criteria
1. Verification commands are explicit task events.
2. A failed verification marks the verification result as failed.
3. The agent may replan after a failed verification if execution policy permits.
4. Reviewer output is clearly labeled as review, not execution.
5. Final completion includes verification status.

### Included scope
- Test commands.
- Build commands.
- Lint commands.
- Reviewer model.
- Final summary.

### OUT OF SCOPE
- Guaranteeing defect-free code.
- Production monitoring.

---

## F-17: Activity Stream and Auditability

### Description
The system provides a chronological record of meaningful task and policy events.

### User story
As a developer, I want to understand what happened during an agent run.

### Acceptance criteria
1. Events have timestamps and sequence ordering.
2. Events include actor type: user, system, agent, bridge, or tool.
3. Events cannot be edited through normal product APIs.
4. Sensitive values are redacted from event payloads.
5. Task activity remains visible after task completion.

### Included scope
- Task events.
- Approval events.
- Model routing events.
- Tool events.
- Verification events.
- Failure events.

### OUT OF SCOPE
- Immutable blockchain logging.
- Legal compliance archival guarantees.

---

# 5. USER ROLES

## Individual User
Permissions:
- Create personal workspaces.
- Connect own providers.
- Register own Local Bridge.
- Create and manage tasks in owned workspaces.
- Configure personal preferences.

## Workspace Owner
Permissions:
- All workspace actions.
- Invite/remove members.
- Configure workspace policies.
- Configure instructions.
- Configure workspace MCP servers.
- Archive/restore workspace.

## Workspace Member
Permissions:
- View workspace resources granted by membership.
- Create tasks.
- Approve own task requests only when policy allows.
- Inspect task activity and diffs.
- Cannot modify owner-only policies.

## Workspace Viewer
Permissions:
- Read workspace metadata.
- Read tasks, plans, activity, and diffs.
- Cannot create execution tasks.
- Cannot modify workspace settings.

## System Administrator
Permissions:
- Platform support operations.
- Cannot read decrypted provider credentials.
- Cannot silently execute user tools.

---

# 6. FUNCTIONAL REQUIREMENTS

FR-001: Every protected request must resolve an authenticated user.
FR-002: Every workspace-scoped request must verify membership.
FR-003: Every task must reference one workspace and one project root.
FR-004: Every agent run must have a run identifier.
FR-005: Every state transition must be persisted transactionally.
FR-006: Tool calls must be validated against policy before execution.
FR-007: Tool calls must have a timeout.
FR-008: Secrets must be redacted from logs and context by default.
FR-009: Provider credentials must be encrypted at rest.
FR-010: The PWA must receive realtime task events.
FR-011: The client must reconnect and resume event consumption using the last confirmed sequence number.
FR-012: A task must not execute two active runs concurrently.
FR-013: Cancellation must be propagated to the Agent Runtime and active tool call where supported.
FR-014: Local Bridge requests must include authenticated, short-lived authorization.
FR-015: Path traversal outside registered project roots must be rejected.
FR-016: Model invocation metadata must record provider, model, stage, and timestamps.
FR-017: A user must be able to inspect task context manifests.
FR-018: Approval decisions must be auditable.
FR-019: Rollback must require a valid checkpoint.
FR-020: Archived workspaces must reject new execution runs.

---

# 7. NON-FUNCTIONAL REQUIREMENTS

## Performance
- PWA initial interactive load target: under 3 seconds on a typical broadband connection for the production shell.
- API authorization checks: target p95 under 150 ms excluding external dependencies.
- Realtime task event delivery target: p95 under 2 seconds after backend event creation.
- Task creation response: under 500 ms excluding model execution.
- Tool output streaming must be chunked; the system must not require loading the complete output before showing progress.

## Scalability
- Agent runs execute independently through queue-backed workers.
- Stateless API services scale horizontally.
- WebSocket instances support shared event fan-out.
- Long-running model/tool execution must not block HTTP request workers.
- Database schema uses indexed foreign keys and indexed lifecycle/status fields used for task queries.

## Security basics
- TLS for production network traffic.
- Password hashing using Argon2id.
- JWT access tokens with short expiration and refresh token rotation.
- AES-256-GCM encryption for provider credentials at rest.
- Workspace authorization on every scoped endpoint.
- Rate limits on authentication, task creation, provider testing, and tool execution requests.
- No provider key returned after initial submission.
- Secrets redacted from logs.
- Local Bridge only accesses registered roots.
- Tool input schema validation.
- Command execution timeout and output limits.

## Reliability
- Terminal task states are `COMPLETED`, `FAILED`, `CANCELLED`, and `INTERRUPTED`.
- Interrupted runs can be inspected and explicitly retried.
- External provider failure must not corrupt task state.
- Duplicate event delivery must be idempotently handled by event IDs.

---

# 8. EDGE CASES

## Provider unavailable
Expected behavior:
1. Record provider failure.
2. Use only configured fallback route.
3. If no fallback exists, mark the current stage failed.
4. Do not silently select another provider.

## Local Bridge disconnects during execution
Expected behavior:
1. Mark active local tool call interrupted.
2. Move task to `INTERRUPTED` if execution cannot continue.
3. Preserve completed changes and activity.
4. Require explicit retry/resume.

## Approval expires
Expected behavior:
1. Reject the pending tool call.
2. Return the task to a waiting state.
3. Require a new approval.

## Agent requests a path outside registered root
Expected behavior:
1. Deny the request.
2. Record a policy denial event.
3. Do not expose existence of inaccessible files.

## Terminal command exceeds timeout
Expected behavior:
1. Attempt process termination.
2. Mark tool call `TIMED_OUT`.
3. Preserve partial output subject to output limits.
4. Allow the agent to replan if policy permits.

## Task canceled during tool execution
Expected behavior:
1. Send cancellation to the runtime.
2. Stop scheduling new tool calls.
3. Attempt cancellation of the active tool.
4. Mark final state `CANCELLED` or `INTERRUPTED` if the active tool cannot confirm cancellation.

## Verification fails
Expected behavior:
1. Record failed verification.
2. Agent may replan only within task budget and policy.
3. If not fixed, final result is not reported as verified success.

## Concurrent changes by user
Expected behavior:
1. Detect project state drift before write phases.
2. Create a conflict event.
3. Stop automatic overwrite of conflicting content.
4. Require re-read/replan or user resolution.

## Context exceeds model limit
Expected behavior:
1. Preserve required instructions.
2. Summarize or omit lower-priority context according to deterministic policy.
3. Record omitted/summarized items in the context manifest.
