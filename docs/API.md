# AI Harness — API Reference

## Base URL

| Environment | URL |
|---|---|
| Local development | `http://localhost:4000` |
| Staging | `https://api-staging.aiharness.dev` |
| Production | `https://api.aiharness.dev` |

## Interactive Documentation

Swagger UI is available at `/docs` when the API server is running:

```
http://localhost:4000/docs
```

The OpenAPI 3.1 spec is served at `/docs/json`.

## Authentication

All protected endpoints require a Bearer JWT token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Obtain tokens via the auth endpoints below. Access tokens expire after 15 minutes; use the refresh endpoint to rotate.

## Common Response Envelope

All API responses follow a consistent envelope:

```json
{
  "data": { ... },
  "meta": { "requestId": "uuid" }
}
```

Errors follow:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [{ "field": "email", "message": "Invalid email" }]
  }
}
```

## Rate Limiting

Protected endpoints are rate-limited per user (or per IP when
unauthenticated). The global budget is `RATE_LIMIT_GLOBAL_MAX` requests per
minute (default `100`); auth routes add their own buckets
(`RATE_LIMIT_SIGNUP_PER_HOUR`, `RATE_LIMIT_LOGIN_PER_15MIN`,
`RATE_LIMIT_RESET_PER_HOUR`). Rate limit headers are returned:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1699900000
```

When exceeded, returns `429 Too Many Requests`.

---

## Provider Matrix

Every model call goes through the adapter registry
(`backend/packages/model-adapters/src/registry.ts`) — the application never
imports a provider SDK directly. Credentials are stored AES-256-GCM encrypted
and decrypted only when building the adapter reference (never logged).

| `providerType` | Adapter | Credential | Base URL | Streaming | Tool proposals | Notes |
|---|---|---|---|:---:|:---:|---|
| `ANTHROPIC` | `AnthropicAdapter` | required | SDK default or `metadata.baseUrl` | ✓ | ✓ | Claude models |
| `OPENAI` | `OpenAIAdapter` | required | SDK default or `metadata.baseUrl` | ✓ | ✓ | GPT models |
| `OPENAI_COMPATIBLE` | `OpenAICompatibleAdapter` | optional | **required** (`metadata.baseUrl`) | ✓ | — | Any OpenAI-shaped endpoint (xAI, Mistral, Groq, vLLM, ...) |
| `GOOGLE` | `GoogleAdapter` | required | optional override (`metadata.baseUrl`) | ✓ | — | Gemini |
| `OLLAMA` | `OllamaAdapter` | none | **required** (`metadata.baseUrl`, e.g. `http://localhost:11434`) | ✓ | — | Local models |
| `TEST` | `TestAdapter` | none | — | — | — | Deterministic; tests only — never wire a production connection to it |

- Streaming is implemented natively on all five real adapters; each is
  covered by wire-contract tests against mock provider HTTP servers
  (`model-adapters/src/wire-contract.test.ts`).
- Failures normalize to `AdapterError { providerType, code, retryable }` —
  the caller (planner/worker) decides retries from `retryable`, never from
  provider-specific error shapes.
- `GET /v1/providers/:id/health` probes a connection;
  `metadata.healthCheckModel` selects the probe model.

---

## Endpoints

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/auth/signup` | Register a new account |
| `POST` | `/v1/auth/login` | Email/password login |
| `POST` | `/v1/auth/refresh` | Rotate refresh token |
| `POST` | `/v1/auth/logout` | Invalidate session |
| `POST` | `/v1/auth/forgot-password` | Request password reset |
| `POST` | `/v1/auth/reset-password` | Reset password with token |
| `GET` | `/v1/auth/github` | Initiate GitHub OAuth |
| `GET` | `/v1/auth/github/callback` | GitHub OAuth callback |
| `GET` | `/v1/auth/google` | Initiate Google OAuth |
| `GET` | `/v1/auth/google/callback` | Google OAuth callback |
| `POST` | `/v1/auth/2fa/setup` | Enable two-factor auth |
| `POST` | `/v1/auth/2fa/verify` | Verify 2FA code |
| `DELETE` | `/v1/auth/2fa` | Disable two-factor auth |

### Workspaces

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/workspaces` | List user's workspaces |
| `POST` | `/v1/workspaces` | Create workspace |
| `GET` | `/v1/workspaces/:id` | Get workspace details |
| `PATCH` | `/v1/workspaces/:id` | Update workspace |
| `DELETE` | `/v1/workspaces/:id` | Delete workspace |
| `POST` | `/v1/workspaces/:id/invite` | Invite member |
| `GET` | `/v1/workspaces/:id/members` | List members |
| `PATCH` | `/v1/workspaces/:id/members/:userId` | Update member role |
| `DELETE` | `/v1/workspaces/:id/members/:userId` | Remove member |
| `GET` | `/v1/workspaces/:id/ip-allowlist` | Get IP allowlist |
| `PUT` | `/v1/workspaces/:id/ip-allowlist` | Update IP allowlist |
| `GET` | `/v1/workspaces/:id/rate-limits` | Get rate limit config |
| `PUT` | `/v1/workspaces/:id/rate-limits` | Update rate limits |
| `GET` | `/v1/workspaces/:id/cost-alerts` | Get cost alert config |
| `PUT` | `/v1/workspaces/:id/cost-alerts` | Update cost alerts |
| `GET` | `/v1/workspaces/:id/audit-retention` | Get audit retention |
| `PUT` | `/v1/workspaces/:id/audit-retention` | Update audit retention |
| `POST` | `/v1/workspaces/:id/backup` | Create workspace backup |
| `GET` | `/v1/workspaces/:id/backups` | List backups |

### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/workspaces/:wid/projects` | List projects |
| `POST` | `/v1/workspaces/:wid/projects` | Create project |
| `GET` | `/v1/projects/:id` | Get project |
| `PATCH` | `/v1/projects/:id` | Update project |
| `DELETE` | `/v1/projects/:id` | Delete project |
| `POST` | `/v1/projects/:id/clone` | Clone project |
| `GET` | `/v1/projects/:id/files` | List project files |
| `GET` | `/v1/projects/:id/files/*` | Read file content |
| `PUT` | `/v1/projects/:id/files/*` | Write file |
| `DELETE` | `/v1/projects/:id/files/*` | Delete file |
| `GET` | `/v1/projects/:id/versions` | List file versions |
| `GET` | `/v1/projects/:id/terminal` | Terminal session |
| `GET` | `/v1/projects/:id/preview` | Preview server |
| `GET` | `/v1/projects/:id/env-vars` | List env vars |
| `PUT` | `/v1/projects/:id/env-vars` | Update env vars |
| `GET` | `/v1/projects/:id/permissions` | Get project permissions |
| `PUT` | `/v1/projects/:id/permissions` | Update project permissions |

### Tasks

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/tasks` | List tasks |
| `POST` | `/v1/tasks` | Create task |
| `GET` | `/v1/tasks/:id` | Get task |
| `PATCH` | `/v1/tasks/:id` | Update task |
| `POST` | `/v1/tasks/:id/cancel` | Cancel task |
| `POST` | `/v1/tasks/:id/pause` | Pause task |
| `POST` | `/v1/tasks/:id/resume` | Resume task |
| `GET` | `/v1/tasks/:id/events` | Get task events |
| `GET` | `/v1/tasks/:id/diff` | Get task diff |
| `GET` | `/v1/tasks/:id/branches` | Get task branches |
| `POST` | `/v1/tasks/:id/export` | Export task |
| `GET` | `/v1/tasks/:id/sessions` | List sessions |
| `POST` | `/v1/tasks/:id/sessions` | Create session |
| `GET` | `/v1/tasks/templates` | List task templates |
| `POST` | `/v1/tasks/templates` | Create task template |

### Plans

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/tasks/:id/plans` | List plans for task |
| `POST` | `/v1/tasks/:id/plans` | Create plan |
| `GET` | `/v1/plans/:id` | Get plan |
| `POST` | `/v1/tasks/:taskId/plans/:planId/approve` | Approve plan |
| `POST` | `/v1/tasks/:taskId/plans/:planId/reject` | Reject plan |

### Approvals

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/tasks/:taskId/approvals` | List approvals for task |
| `POST` | `/v1/approvals/:approvalId/approve` | Approve action |
| `POST` | `/v1/approvals/:approvalId/deny` | Deny action |

### Providers (AI Models)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/providers` | List provider connections |
| `POST` | `/v1/providers` | Add provider connection |
| `GET` | `/v1/providers/:id` | Get provider |
| `PATCH` | `/v1/providers/:id` | Update provider |
| `DELETE` | `/v1/providers/:id` | Delete provider |
| `GET` | `/v1/providers/:id/health` | Check provider health |

### Deployments

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/deployments` | List deployments |
| `POST` | `/v1/deployments` | Create deployment |
| `GET` | `/v1/deployments/:id` | Get deployment |
| `POST` | `/v1/deployments/:id/rollback` | Rollback deployment |
| `GET` | `/v1/deployments/:id/comments` | Get deployment comments |
| `POST` | `/v1/deployments/:id/comments` | Add deployment comment |
| `GET` | `/v1/deployment-secrets` | List deployment secrets |
| `POST` | `/v1/deployment-secrets` | Create deployment secret |
| `DELETE` | `/v1/deployment-secrets/:id` | Delete deployment secret |

### Organizations

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/organizations` | List organizations |
| `POST` | `/v1/organizations` | Create organization |
| `GET` | `/v1/organizations/:id` | Get organization |
| `PATCH` | `/v1/organizations/:id` | Update organization |
| `GET` | `/v1/organizations/:id/members` | List members |
| `GET` | `/v1/organizations/:id/settings` | Get settings |
| `PATCH` | `/v1/organizations/:id/settings` | Update settings |
| `GET` | `/v1/organizations/:id/roles` | List roles |
| `POST` | `/v1/organizations/:id/roles` | Create role |
| `GET` | `/v1/organizations/:id/domains` | List verified domains |
| `POST` | `/v1/organizations/:id/domains` | Verify domain |

### SSO/SAML

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/workspaces/:workspaceId/sso` | List SSO configurations |
| `POST` | `/v1/workspaces/:workspaceId/sso` | Create SSO configuration (created enabled) |
| `GET` | `/v1/workspaces/:workspaceId/sso/:configId` | Get SSO configuration by ID |
| `PUT` | `/v1/workspaces/:workspaceId/sso/:configId` | Update SSO configuration |
| `DELETE` | `/v1/workspaces/:workspaceId/sso/:configId` | Delete SSO configuration |
| `GET` | `/v1/workspaces/:workspaceId/sso/:configId/test` | Test SSO configuration |
| `GET` | `/v1/workspaces/:workspaceId/sso/saml/metadata` | Get SAML metadata |
| `GET` | `/v1/sso/:workspaceId/:provider/login` | Initiate SSO login (returns redirect URL + state) |
| `POST` | `/v1/sso/:workspaceId/:provider/callback` | OAuth code callback |
| `POST` | `/v1/sso/:workspaceId/saml/callback` | SAML assertion callback |

### Admin

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/users` | List all users |
| `GET` | `/v1/admin/audit-logs` | List audit logs |
| `POST` | `/v1/admin/bulk` | Bulk operations |

### Notifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/notifications` | List notifications |
| `PATCH` | `/v1/notifications/:id` | Mark as read |
| `POST` | `/v1/notifications/read-all` | Mark all as read |
| `GET` | `/v1/inbox` | Get inbox |
| `GET` | `/v1/webhooks` | List webhooks |
| `POST` | `/v1/webhooks` | Create webhook |
| `DELETE` | `/v1/webhooks/:id` | Delete webhook |

### Other

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Health check (returns 503 if DB down) |
| `GET` | `/v1/bridges` | List device bridges |
| `POST` | `/v1/bridges` | Register bridge |
| `GET` | `/v1/mcp/servers` | List MCP servers |
| `POST` | `/v1/mcp/servers` | Register MCP server |
| `GET` | `/v1/mcp/servers/:serverId` | Get one server (owner-only) |
| `PATCH` | `/v1/mcp/servers/:serverId` | Update name / status / config (config change invalidates the discovery cache) |
| `DELETE` | `/v1/mcp/servers/:serverId` | Delete a server (drops its discovery cache) |
| `POST` | `/v1/workspaces/:workspaceId/mcp/:serverId/enable` | Enable in a workspace (runs tool discovery) |
| `POST` | `/v1/workspaces/:workspaceId/mcp/:serverId/disable` | Disable in a workspace |
| `GET` | `/v1/workspaces/:workspaceId/mcp` | List servers linked to a workspace |
| `GET` | `/v1/api-keys` | List API keys |
| `POST` | `/v1/api-keys` | Create API key |
| `DELETE` | `/v1/api-keys/:id` | Revoke API key |
| `GET` | `/v1/usage` | Get usage stats |
| `GET` | `/v1/admin/audit-logs/export` | Export audit logs |

### WebContainer

Session-scoped dev containers. Each session owns a private directory used for
file sync and command execution (commands time out after 10s).

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/webcontainer/create` | Create a session (`{ workspaceId }`) |
| `POST` | `/v1/webcontainer/:sessionId/files` | Sync files (path-safe writes, returns `{ synced }`) |
| `POST` | `/v1/webcontainer/:sessionId/run` | Execute a command (`{ command }` → `{ exitCode, stdout, stderr }`) |
| `GET` | `/v1/webcontainer/:sessionId/status` | Session status + `fileCount` |
| `GET` | `/v1/webcontainer/sessions` | List sessions for a workspace |
| `DELETE` | `/v1/webcontainer/:sessionId` | Shutdown session (removes its files) |

### Multiplayer

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/multiplayer/:taskId/join` | Join a session → `{ taskId, userId, wsUrl }` |
| `GET` | `/v1/multiplayer/:taskId/users` | Connected users (Redis-backed presence) |
| `POST` | `/v1/multiplayer/:taskId/cursor` | Broadcast cursor position |
| `POST` | `/v1/multiplayer/:taskId/selection` | Broadcast selection range |

Realtime fan-out (presence/awareness/cursor/selection/Yjs) runs over
`/multiplayer` WebSockets and replicates across API replicas via Redis
pub/sub.

---

## WebSocket Events

Connect to the API server with Socket.IO for realtime task events:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:4000", {
  auth: { token: "<access_token>" },
});

socket.on("task:event", (event) => {
  // envelope: { id, taskId, runId, sequenceNumber, eventType, actorType, payload, createdAt }
  console.log(event.eventType, event.payload);
});
```

### Event Types

| Event | Payload | Description |
|---|---|---|
| `RUN_CREATED` | `TaskRun` | New run started |
| `RUN_STARTED` | `TaskRun` | Run began execution |
| `RUN_COMPLETED` | `TaskRun` | Run finished successfully |
| `RUN_FAILED` | `TaskRun` | Run failed |
| `PLAN_CREATED` | `TaskPlan` | Agent created a plan |
| `PLAN_APPROVAL_REQUIRED` | `TaskPlan` | Plan needs human approval |
| `PLAN_APPROVED` | `TaskPlan` | Human approved plan |
| `TOOL_REQUESTED` | `ToolCall` | Tool invocation requested |
| `TOOL_APPROVAL_REQUIRED` | `ToolCall` | Tool needs approval |
| `TOOL_STARTED` | `ToolCall` | Tool execution started |
| `TOOL_COMPLETED` | `ToolCall` | Tool finished |
| `TOOL_FAILED` | `ToolCall` | Tool execution failed |
| `CHECKPOINT_CREATED` | `Checkpoint` | Filesystem snapshot saved |
| `CHECKPOINT_RESTORED` | `Checkpoint` | Rolled back to checkpoint |
| `DEPLOYMENT_STARTED` | `Deployment` | Deployment initiated |
| `DEPLOYMENT_COMPLETED` | `Deployment` | Deployment succeeded |
| `DEPLOYMENT_FAILED` | `Deployment` | Deployment failed |

## Usage & Cost Analytics

All usage endpoints require a bearer token; workspace-scoped calls also
require at least `VIEWER` on that workspace. Rows come from `usage_records`
— one per model call, written by the worker with provider-reported token
counts and an `estimatedCost`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/usage` | Summary for the caller (optional `workspaceId`, `startDate`, `endDate`): `inputTokens`, `outputTokens`, `totalTokens`, `estimatedCost`, `totalCalls` |
| `GET` | `/v1/usage/by-model` | Per-model token/cost breakdown |
| `GET` | `/v1/usage/by-task` | Per-task usage |
| `GET` | `/v1/usage/trend` | Time series for charting |
| `GET` | `/v1/usage/cost-summary` | Rolled-up estimated cost |
| `GET` | `/v1/usage/cost-breakdown` | Cost split by model/task |
| `GET` | `/v1/usage/cost-alerts` | Configured budget alerts |
| `GET` | `/v1/usage/analytics/daily` | Daily aggregates |
| `GET` | `/v1/usage/analytics/monthly` | Monthly aggregates |
| `GET` | `/v1/usage/anomalies` | Statistical anomaly detection on spend |
| `GET` | `/v1/usage/quota` | Quota/limit state |

**Vocabulary:** *tokens* are the provider-reported input/output/total counts;
*estimatedCost* multiplies those counts by the model's price card — it is an
estimate, never an invoice (price cards live in
[MODELS_AND_PRICING.md](MODELS_AND_PRICING.md)); *quota* is the configured
spend/call ceiling; *cost alerts* fire before a quota is breached;
*anomalies* flags statistically abnormal spend spikes.

## Billing & Subscriptions

Stripe-backed and env-gated (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
`POST /v1/billing/webhook` verifies the Stripe signature before acting.
`GET /v1/billing/subscription` is the source of truth the UI reads after
checkout, cancel, or reactivate callbacks land.

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/billing/plans` | Plan catalog |
| `GET` | `/v1/billing/subscription` | Current subscription for the caller |
| `GET` | `/v1/billing/subscriptions` | Subscriptions list (org/admin scope) |
| `POST` | `/v1/billing/checkout` | Create a Stripe checkout session |
| `POST` | `/v1/billing/portal` | Stripe customer-portal session |
| `POST` | `/v1/billing/subscription/cancel` | Cancel at period end |
| `POST` | `/v1/billing/subscription/reactivate` | Undo a pending cancellation |
| `POST` | `/v1/billing/webhook` | Stripe webhook (signature-verified, public) |

## Recipes — curl, CLI, SDK

### curl

```bash
# 1. Login — envelope: { data: { accessToken, ... } }
TOKEN=$(curl -s http://localhost:4000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}' \
  | jq -r .data.accessToken)

# 2. Authenticated call
curl -s http://localhost:4000/v1/workspaces \
  -H "Authorization: Bearer $TOKEN"
```

### CLI (`aiharness`)

```bash
export AI_HARNESS_URL=http://localhost:4000   # default
export AI_HARNESS_TOKEN=$TOKEN                # env-only config; no config file

aiharness health
aiharness plan "Add retry logic" --project "$PROJECT_ID"
aiharness events "$TASK_ID"                   # live stream until terminal state
```

Full reference: [CLI_GUIDE.md](../CLI_GUIDE.md) (every command, flag, exit code).

### SDK (`@ai-harness/sdk`)

```ts
import { AiHarnessClient } from "@ai-harness/sdk";

const client = new AiHarnessClient({ baseUrl: "http://localhost:4000", token: TOKEN });
const workspaces = await client.listWorkspaces();
const task = await client.createTask({ goal: "Run tests, fail on errors", projectId });
```

Full reference: [SDK_GUIDE.md](../SDK_GUIDE.md) (recipe catalog, error handling, polling).

## Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
