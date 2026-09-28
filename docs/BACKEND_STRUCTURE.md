# AI Harness — Backend Structure

# 1. ARCHITECTURE

The backend is a modular control plane with stateless API services and queue-backed workers.

```text
backend/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── modules/
│   │       ├── middleware/
│   │       ├── plugins/
│   │       └── app.ts
│   ├── worker/
│   │   └── src/
│   │       ├── consumers/
│   │       └── worker.ts
│   └── bridge-gateway/
│       └── src/
├── packages/
│   ├── domain/
│   ├── contracts/
│   ├── database/
│   ├── agent-runtime/
│   ├── model-adapters/
│   ├── tool-harness/
│   ├── permission-engine/
│   ├── context-engine/
│   └── shared/
└── prisma/
    └── schema.prisma
```

## Layer separation

### Transport layer
Routes, request parsing, response serialization, authentication middleware.

### Application layer
Use cases such as:
- CreateTask.
- ApproveToolCall.
- RegisterBridge.
- CreateCheckpoint.

### Domain layer
Entities, value objects, state transitions, permission decisions.

### Infrastructure layer
Prisma repositories, Redis, queues, provider SDKs, storage, Socket.IO.

No route handler may directly call a model SDK or execute a terminal command.

---

# 2. DATABASE SCHEMA

## users
- id: UUID PK
- email: VARCHAR(320) UNIQUE NOT NULL
- password_hash: TEXT NOT NULL
- display_name: VARCHAR(100) NOT NULL
- avatar_url: TEXT NULL
- status: ENUM(ACTIVE, SUSPENDED, DELETED)
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ

## refresh_sessions
- id: UUID PK
- user_id: UUID FK users
- token_hash: TEXT UNIQUE NOT NULL
- expires_at: TIMESTAMPTZ
- revoked_at: TIMESTAMPTZ NULL
- created_at: TIMESTAMPTZ
Relationship: many sessions to one user.

## workspaces
- id: UUID PK
- owner_id: UUID FK users
- name: VARCHAR(120)
- description: TEXT NULL
- execution_mode: ENUM(CLOUD, LOCAL_CONNECTED, HYBRID)
- status: ENUM(ACTIVE, ARCHIVED)
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ

## workspace_members
- id: UUID PK
- workspace_id: UUID FK workspaces
- user_id: UUID FK users
- role: ENUM(OWNER, MEMBER, VIEWER)
- created_at: TIMESTAMPTZ
Unique: workspace_id + user_id.

## projects
- id: UUID PK
- workspace_id: UUID FK workspaces
- bridge_id: UUID NULL FK bridges
- name: VARCHAR(160)
- connection_type: ENUM(CLOUD, LOCAL_BRIDGE)
- repository_url: TEXT NULL
- root_reference: TEXT NOT NULL
- default_branch: VARCHAR(255) NULL
- status: ENUM(AVAILABLE, DEGRADED, UNAVAILABLE)
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ

## workspace_instruction_versions
- id: UUID PK
- workspace_id: UUID FK workspaces
- version: INTEGER
- content: TEXT
- created_by: UUID FK users
- created_at: TIMESTAMPTZ
Unique: workspace_id + version.

## workspace_policies
- id: UUID PK
- workspace_id: UUID UNIQUE FK workspaces
- require_plan_approval: BOOLEAN
- allow_direct_execution: BOOLEAN
- max_task_duration_seconds: INTEGER
- max_tool_calls_per_run: INTEGER
- max_subagents: INTEGER
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ

## tool_policy_rules
- id: UUID PK
- workspace_policy_id: UUID FK workspace_policies
- tool_name: VARCHAR(120)
- action_pattern: TEXT NULL
- risk_level: ENUM(READ, WRITE, DESTRUCTIVE, EXTERNAL)
- decision: ENUM(ALLOW, ASK, DENY)
- created_at: TIMESTAMPTZ

## provider_connections
- id: UUID PK
- user_id: UUID FK users
- provider_type: ENUM(ANTHROPIC, OPENAI, GOOGLE, OLLAMA, OPENAI_COMPATIBLE)
- display_name: VARCHAR(120)
- encrypted_credential: BYTEA NULL
- encrypted_metadata: BYTEA NULL
- status: ENUM(ACTIVE, DISABLED, ERROR)
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ

## workspace_provider_connections
- id: UUID PK
- workspace_id: UUID FK workspaces
- provider_connection_id: UUID FK provider_connections
- created_at: TIMESTAMPTZ
Unique: workspace_id + provider_connection_id.

## model_routes
- id: UUID PK
- workspace_id: UUID FK workspaces
- stage: ENUM(PLANNING, IMPLEMENTATION, REVIEW)
- provider_connection_id: UUID FK provider_connections
- model_identifier: VARCHAR(255)
- fallback_route_id: UUID NULL FK model_routes
- priority: INTEGER
- active: BOOLEAN
- created_at: TIMESTAMPTZ

## tasks
- id: UUID PK
- workspace_id: UUID FK workspaces
- project_id: UUID FK projects
- created_by: UUID FK users
- goal: TEXT
- constraints: TEXT NULL
- state: ENUM(QUEUED, INITIALIZING, UNDERSTANDING, GATHERING_CONTEXT, PLANNING, WAITING_FOR_APPROVAL, EXECUTING, WAITING_FOR_TOOL_APPROVAL, OBSERVING, REPLANNING, VERIFYING, REVIEWING, COMPLETED, FAILED, CANCELLED, INTERRUPTED)
- selected_model_mode: ENUM(MANUAL, ROUTED)
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
- completed_at: TIMESTAMPTZ NULL

## task_runs
- id: UUID PK
- task_id: UUID FK tasks
- run_number: INTEGER
- state: same task lifecycle enum
- started_at: TIMESTAMPTZ NULL
- ended_at: TIMESTAMPTZ NULL
- failure_code: VARCHAR(100) NULL
- failure_message: TEXT NULL
Unique: task_id + run_number.

## task_plans
- id: UUID PK
- task_id: UUID FK tasks
- run_id: UUID FK task_runs
- version: INTEGER
- analysis: TEXT
- affected_files: JSONB
- steps: JSONB
- risks: JSONB
- verification_plan: JSONB
- status: ENUM(DRAFT, APPROVED, REJECTED, SUPERSEDED)
- created_at: TIMESTAMPTZ
- approved_at: TIMESTAMPTZ NULL
- approved_by: UUID NULL FK users

## context_packages
- id: UUID PK
- task_id: UUID FK tasks
- run_id: UUID FK task_runs
- stage: ENUM(PLANNING, IMPLEMENTATION, REVIEW)
- manifest: JSONB
- estimated_tokens: INTEGER
- created_at: TIMESTAMPTZ

## task_events
- id: UUID PK
- task_id: UUID FK tasks
- run_id: UUID FK task_runs
- sequence_number: BIGINT
- event_type: VARCHAR(100)
- actor_type: ENUM(USER, SYSTEM, AGENT, TOOL, BRIDGE)
- payload: JSONB
- created_at: TIMESTAMPTZ
Unique: task_id + sequence_number.

## tool_calls
- id: UUID PK
- task_id: UUID FK tasks
- run_id: UUID FK task_runs
- tool_name: VARCHAR(120)
- risk_level: ENUM(READ, WRITE, DESTRUCTIVE, EXTERNAL)
- input_summary: JSONB
- status: ENUM(PENDING, WAITING_APPROVAL, RUNNING, SUCCEEDED, FAILED, TIMED_OUT, DENIED, CANCELLED)
- result_summary: JSONB NULL
- started_at: TIMESTAMPTZ NULL
- completed_at: TIMESTAMPTZ NULL

## approval_requests
- id: UUID PK
- task_id: UUID FK tasks
- tool_call_id: UUID NULL FK tool_calls
- requested_scope: ENUM(ONCE, TASK)
- status: ENUM(PENDING, APPROVED, DENIED, EXPIRED)
- requested_by_actor: ENUM(AGENT, SYSTEM)
- decided_by: UUID NULL FK users
- expires_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ
- decided_at: TIMESTAMPTZ NULL

## bridges
- id: UUID PK
- user_id: UUID FK users
- name: VARCHAR(120)
- version: VARCHAR(50)
- status: ENUM(PENDING, CONNECTED, DEGRADED, DISCONNECTED, REVOKED)
- capabilities: JSONB
- last_seen_at: TIMESTAMPTZ NULL
- created_at: TIMESTAMPTZ

## bridge_project_roots
- id: UUID PK
- bridge_id: UUID FK bridges
- display_name: VARCHAR(160)
- canonical_root_reference: TEXT
- created_at: TIMESTAMPTZ
Unique: bridge_id + canonical_root_reference.

## mcp_servers
- id: UUID PK
- owner_id: UUID FK users
- name: VARCHAR(120)
- transport_type: ENUM(STDIO, HTTP, SSE)
- encrypted_config: BYTEA
- status: ENUM(DISABLED, ACTIVE, ERROR)
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ

## workspace_mcp_servers
- id: UUID PK
- workspace_id: UUID FK workspaces
- mcp_server_id: UUID FK mcp_servers
- enabled: BOOLEAN
- created_at: TIMESTAMPTZ
Unique: workspace_id + mcp_server_id.

## checkpoints
- id: UUID PK
- task_id: UUID FK tasks
- project_id: UUID FK projects
- checkpoint_type: ENUM(PRE_EXECUTION, MANUAL)
- state_reference: JSONB
- created_by: UUID NULL FK users
- created_at: TIMESTAMPTZ

## verification_results
- id: UUID PK
- task_id: UUID FK tasks
- run_id: UUID FK task_runs
- command: TEXT
- status: ENUM(PASSED, FAILED, SKIPPED, ERROR)
- output_reference: TEXT NULL
- created_at: TIMESTAMPTZ

## audit_logs
- id: UUID PK
- actor_user_id: UUID NULL FK users
- workspace_id: UUID NULL FK workspaces
- action: VARCHAR(120)
- entity_type: VARCHAR(80)
- entity_id: UUID NULL
- metadata: JSONB
- created_at: TIMESTAMPTZ

---

# 3. API ENDPOINTS

## Auth
- POST `/v1/auth/signup`
  - Body: email, password, displayName
  - Auth: No
  - Response: user, accessToken, refreshToken

- POST `/v1/auth/login`
  - Body: email, password
  - Auth: No
  - Response: user, accessToken, refreshToken

- POST `/v1/auth/refresh`
  - Body: refreshToken
  - Auth: No
  - Response: accessToken, refreshToken

- POST `/v1/auth/logout`
  - Auth: Yes
  - Response: `{ success: true }`

- POST `/v1/auth/forgot-password`
  - Body: email
  - Auth: No
  - Response: `{ success: true }`

- POST `/v1/auth/reset-password`
  - Body: token, newPassword
  - Auth: No
  - Response: `{ success: true }`

## Workspaces
- GET `/v1/workspaces`
- POST `/v1/workspaces`
  - Body: name, description?, executionMode
- GET `/v1/workspaces/:workspaceId`
- PATCH `/v1/workspaces/:workspaceId`
- POST `/v1/workspaces/:workspaceId/archive`
- POST `/v1/workspaces/:workspaceId/restore`
- GET `/v1/workspaces/:workspaceId/members`
- POST `/v1/workspaces/:workspaceId/members`
- PATCH `/v1/workspaces/:workspaceId/members/:memberId`
- DELETE `/v1/workspaces/:workspaceId/members/:memberId`

All workspace endpoints require authentication and membership; owner-only operations require OWNER role.

## Projects
- GET `/v1/workspaces/:workspaceId/projects`
- POST `/v1/workspaces/:workspaceId/projects`
- GET `/v1/projects/:projectId`
- PATCH `/v1/projects/:projectId`
- DELETE `/v1/projects/:projectId`

## Instructions and policy
- GET `/v1/workspaces/:workspaceId/instructions`
- POST `/v1/workspaces/:workspaceId/instructions`
- GET `/v1/workspaces/:workspaceId/policy`
- PUT `/v1/workspaces/:workspaceId/policy`

## Providers
- GET `/v1/providers`
- POST `/v1/providers`
- POST `/v1/providers/:providerConnectionId/test`
- PATCH `/v1/providers/:providerConnectionId`
- DELETE `/v1/providers/:providerConnectionId`
- GET `/v1/workspaces/:workspaceId/model-routes`
- PUT `/v1/workspaces/:workspaceId/model-routes`

## Tasks
- GET `/v1/tasks`
- POST `/v1/tasks`
  - Body: workspaceId, projectId, goal, constraints?, selectedModelMode, modelOverride?
  - Auth: Yes
  - Response: task

- GET `/v1/tasks/:taskId`
- POST `/v1/tasks/:taskId/cancel`
- POST `/v1/tasks/:taskId/retry`
- POST `/v1/tasks/:taskId/pause`
- POST `/v1/tasks/:taskId/resume`

## Plans
- GET `/v1/tasks/:taskId/plans`
- POST `/v1/tasks/:taskId/plans/:planId/approve`
- POST `/v1/tasks/:taskId/plans/:planId/reject`
- POST `/v1/tasks/:taskId/plans/:planId/revise`

## Context
- GET `/v1/tasks/:taskId/context`
- GET `/v1/tasks/:taskId/context/:contextPackageId`

## Activity
- GET `/v1/tasks/:taskId/events?afterSequence=`

## Approvals
- GET `/v1/tasks/:taskId/approvals`
- POST `/v1/approvals/:approvalId/approve`
- POST `/v1/approvals/:approvalId/deny`

## Changes and checkpoints
- GET `/v1/tasks/:taskId/changes`
- GET `/v1/tasks/:taskId/checkpoints`
- POST `/v1/checkpoints/:checkpointId/rollback`

## Verification
- GET `/v1/tasks/:taskId/verification`

## Bridges
- POST `/v1/bridges/pairing-tokens`
- POST `/v1/bridges/pair`
- GET `/v1/bridges`
- GET `/v1/bridges/:bridgeId`
- PATCH `/v1/bridges/:bridgeId`
- POST `/v1/bridges/:bridgeId/revoke`
- GET `/v1/bridges/:bridgeId/project-roots`
- POST `/v1/bridges/:bridgeId/project-roots`

## MCP
- GET `/v1/mcp/servers`
- POST `/v1/mcp/servers`
- GET `/v1/mcp/servers/:serverId`
- PATCH `/v1/mcp/servers/:serverId`
- DELETE `/v1/mcp/servers/:serverId`
- POST `/v1/workspaces/:workspaceId/mcp/:serverId/enable`
- POST `/v1/workspaces/:workspaceId/mcp/:serverId/disable`

---

# 4. STANDARD RESPONSE FORMAT

Success:
```json
{
  "data": {},
  "requestId": "uuid"
}
```

Error:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  },
  "requestId": "uuid"
}
```

Error codes:
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `CONFLICT`
- `RATE_LIMITED`
- `WORKSPACE_ARCHIVED`
- `PROJECT_UNAVAILABLE`
- `PROVIDER_UNAVAILABLE`
- `APPROVAL_REQUIRED`
- `APPROVAL_EXPIRED`
- `POLICY_DENIED`
- `TOOL_TIMEOUT`
- `BRIDGE_DISCONNECTED`
- `INTERNAL_ERROR`

---

# 5. BUSINESS LOGIC

## Task module
- Enforces one active run per task.
- Persists state transitions.
- Enqueues Agent Runtime work.
- Publishes task events.

## Agent module
- Loads task configuration.
- Builds context.
- selects model.
- invokes model.
- validates tool calls.
- transitions state.

## Permission module
Input:
- workspace policy;
- tool name;
- action;
- risk;
- existing task approvals.

Output:
- ALLOW;
- ASK;
- DENY.

## Context module
- Collects candidate context.
- Redacts secrets.
- Applies deterministic priority.
- Produces manifest and bounded package.

## Bridge module
- Registers device.
- Maintains connection.
- Routes authorized local tool requests.
- Rejects paths outside registered roots.

## Checkpoint module
- Requests project-state snapshot.
- Stores checkpoint reference.
- Validates rollback confirmation.

---

# 6. ERROR HANDLING

1. Every request receives a request ID.
2. Validation errors return `400`.
3. Authentication failure returns `401`.
4. Authorization failure returns `403`.
5. Missing entity returns `404`.
6. State conflict returns `409`.
7. Rate limit returns `429`.
8. Unexpected failures return `500`.
9. Raw internal stack traces are logged server-side only.
10. External provider errors are normalized without exposing credentials.

---

# 7. SECURITY

## Authentication checks
- Verify JWT on protected endpoints.
- Verify refresh token rotation.
- Verify user membership on workspace resources.
- Verify role on owner-only actions.

## Rate limiting
Initial production limits:
- Login: 10 requests / 15 minutes / IP.
- Signup: 5 requests / hour / IP.
- Password reset: 5 requests / hour / IP.
- Task creation: 30 requests / hour / user.
- Tool approval decisions: 120 requests / minute / user.

## Data isolation
- All workspace queries include workspace authorization.
- Provider credentials are user-owned and workspace-linked explicitly.
- Local bridge roots are bridge-owned and explicitly selected.

## Command execution
- No shell access from HTTP API directly.
- Commands execute only through Tool Harness -> Bridge or Cloud Sandbox.
- Timeout and output limits are mandatory.
- Environment secrets are not included in model context by default.
