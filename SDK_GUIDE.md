# SDK Guide

`@ai-harness/sdk` is the thinnest possible client for the AI Harness REST
API: one class, one HTTP pipeline, every method a direct mapping to a
documented endpoint. This guide is the hub — the surfaces around it (CLI,
CI, IDE extension, webhooks) are spokes.

```text
                    ┌──────────────┐
        ┌──────────▶│   REST API   │◀───────────┐
        │           │  (the hub)   │            │
        │           └──────┬───────┘            │
   SDK client          web app            raw fetch
        │                                          │
   ┌────┴─────┐                              IDE extension
   │   CLI    │  (sdk is its only dependency)
   └────┬─────┘
     CI jobs
```

**Honest scope:** the SDK wraps ~31 of the API's endpoints. It has no
auth helpers, no websocket client, and no retries configuration beyond the
matrix below. Where it stops, this guide shows the raw REST equivalent —
never a guess.

---

## Install

The package is **private and workspace-local** (never published to npm):

```bash
# inside the monorepo
import { AiHarnessClient, SDKError } from "@ai-harness/sdk";
```

- ESM only; `main` points at the TypeScript source — import it through a
  workspace (CLI does), `tsx`, or a bundler that transpiles TS.
- Declared deps (`@ai-harness/contracts`, `@ai-harness/events`) are
  currently unused by the client code; the runtime needs nothing but
  `fetch` (Node ≥ 18).

---

## Quickstart

```typescript
import { AiHarnessClient } from "@ai-harness/sdk";

const client = new AiHarnessClient({
  baseUrl: process.env.AI_HARNESS_URL ?? "http://localhost:4000",
  token: process.env.AI_HARNESS_TOKEN!,   // 15-min access token, see Authentication
});

// 1. create a task — the workspace is resolved from the project
const task = await client.createTask({
  goal: "Add a /health alias with one test",
  projectId: "9bc32d2b-…",              // required: every task belongs to a project
  agentMode: "BUILD",                    // BUILD | PLAN | ASK | REVIEW | FIX
});
console.log(task.id, task.state);        // "…" "QUEUED"

// 2. follow it to a decision point
for await (const event of client.streamEvents(task.id)) {
  if (event.eventType === "PLAN_CREATED") break;
}

// 3. steer or approve (fetch the plan id first — see Plans)
// await client.revisePlan(task.id, planId, "also update the OpenAPI doc");
// await client.approvePlan(task.id, planId);

// 4. read the outcome
const done = await client.getTask(task.id);
console.log(done.state);                 // COMPLETED | FAILED | …
```

---

## Client configuration

```typescript
new AiHarnessClient(config: SDKConfig)
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `baseUrl` | string | required | e.g. `http://localhost:4000` |
| `token` | string? | — | sent as `Authorization: Bearer <jwt>` |
| `apiKey` | string? | — | also sent as `Bearer`; **wins over `token`** when both set |
| `timeoutMs` | number | `30_000` | per-request `AbortController` deadline |
| `maxRetries` | number | `3` | extra attempts for retryable failures (see [Errors](#error-handling)) |

Behavior worth knowing:

- If neither `token` nor `apiKey` is set, **no Authorization header is
  sent** — fine for `/health`, `401` for everything else.
- Every response is unwrapped from the API's `{ data: … }` envelope
  transparently; you receive the payload.
- There are no other options: no proxy config, no agent, no interceptors.

---

## Authentication (the SDK stays out of it)

The SDK has **no login/signup/refresh methods** — tokens are minted by the
API and handed in as `token`:

```bash
# login → accessToken (15-minute TTL)
TOKEN=$(curl -s -X POST $API/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"…","password":"…"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.accessToken")

# refresh before it expires
curl -s -X POST $API/v1/auth/refresh -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}"
```

- Signup: `POST /v1/auth/signup` (also returns tokens).
- Sessions/devices: `GET|DELETE /v1/auth/sessions`.
- SSO/OIDC login exists for workspaces — see
  [Enterprise Setup](docs/ENTERPRISE_SETUP.md).
- **API keys are not Bearer credentials today.** Keys created via
  `POST /v1/api-keys` are stored hashed (`ai_…` prefix) but no request path
  validates them yet — putting one in `apiKey` will `401`.

---

## Method reference

31 methods, grouped. All are `async` and return the unwrapped payload.

### Health

| Method | Endpoint | Returns |
|---|---|---|
| `health()` | `GET /v1/health` | `{ status, checks }` |

### Workspaces & projects

| Method | Endpoint | Notes |
|---|---|---|
| `listWorkspaces()` | `GET /v1/workspaces` | your memberships |
| `listProjects(workspaceId)` | `GET /v1/workspaces/:wid/projects` | |
| `createProject(workspaceId, { name, description?, rootReference?, connectionType? })` | `POST /v1/workspaces/:wid/projects` | |

Workspace create/update and member management are **not** wrapped (REST in
[API Reference](docs/API.md)).

### Tasks

| Method | Endpoint | Notes |
|---|---|---|
| `createTask({ goal, projectId, workspaceId?, agentMode?, constraints? })` | `POST /v1/tasks` | if `workspaceId` is omitted, the SDK fetches the project first and derives it |
| `getTask(taskId)` | `GET /v1/tasks/:id` | |
| `updateTask(taskId, { goal })` | `PATCH /v1/tasks/:id` | |
| `pauseTask(taskId)` | `POST …/pause` | **thin return:** `{ id, pauseRequested: true }` (typed as `Task`) |
| `resumeTask(taskId)` | `POST …/resume` | **thin return:** `{ id, state: "QUEUED" }`; only valid from `INTERRUPTED` |
| `cancelTask(taskId)` | `POST …/cancel` | **thin return:** `{ id, cancelRequested: true }` |
| `retryTask(taskId)` | `POST …/retry` | **thin return:** `{ id, state: "QUEUED" }`; terminal/interrupted tasks only |
| `listTasks(workspaceId, { state?, limit? })` | `GET /v1/tasks?workspaceId=…` | tasks **are** sessions here |
| `listTaskRuns(taskId)` | `GET /v1/tasks/:id/runs` | one row per execution attempt (state, tokens, cost) |
| `searchTasks(query, workspaceId?)` | `POST /v1/tasks/search` | |

Server rules you'll hit: tasks require workspace **MEMBER** role; creation
is rate-limited to **30/hour/user**; `pause`/`cancel` are *requests* —
confirm with `getTask`.

### Plans

| Method | Endpoint | Notes |
|---|---|---|
| `approvePlan(taskId, planId)` | `POST …/plans/:pid/approve` | unblocks `WAITING_FOR_APPROVAL` |
| `rejectPlan(taskId, planId, reason)` | `POST …/plans/:pid/reject` | returns `{ success, taskState }`; reason is accepted but not persisted yet |
| `revisePlan(taskId, planId, instruction)` | `POST …/plans/:pid/revise` | sends `{ instruction }`; parks at `PLANNING` for the next draft |

Plan ids come from `GET /v1/tasks/:taskId/plans` — **that list endpoint is
not wrapped**:

```typescript
const plans = await fetch(`${base}/v1/tasks/${taskId}/plans`, { headers });
const [{ id: planId }] = (await plans.json()).data;
```

### Tool approvals

| Method | Endpoint | Notes |
|---|---|---|
| `approveTool(approvalId)` | `POST /v1/approvals/:id/approve` | 120/min rate limit |
| `denyTool(approvalId, reason)` | `POST /v1/approvals/:id/deny` | reason accepted, not persisted yet |

Approval ids arrive as `approval:created` socket events or
`TOOL_*` log events. Also unwrapped: `GET /v1/tasks/:id/approvals` (the
pending list).

### Events

| Method | Endpoint | Notes |
|---|---|---|
| `streamEvents(taskId, pollIntervalMs = 1000, abortSignal?)` | polls `GET /v1/tasks/:id/events` + `GET /v1/tasks/:id` | async generator (semantics below) |
| `listTaskEvents(taskId)` | `GET /v1/tasks/:id/events` | **first page only** (default limit 200, ascending) |

Event envelope (both methods yield the same shape):

```typescript
interface TaskEvent {
  id: string;
  taskId: string;
  runId: string | null;
  sequenceNumber: number;               // strictly increasing per task
  eventType: string;                    // RUN_*, PLAN_*, TOOL_*, CHECKPOINT_*, DEPLOYMENT_*
  actorType: "USER" | "SYSTEM" | "AGENT" | "TOOL" | "BRIDGE";
  payload: Record<string, unknown> | null;
  createdAt: string;                    // ISO
}
```

**`streamEvents` semantics (verified):**

- Polls the events endpoint incrementally with `afterSequence` (page size
  200, so runs longer than 200 events are **not** truncated) every
  `pollIntervalMs`.
- Also polls task state each cycle and **stops on `COMPLETED`,
  `FAILED`, `CANCELLED`, or `INTERRUPTED`**, plus a hard 1-hour deadline.
- `abortSignal` cancels between cycles. Duplicates are impossible by
  construction (strictly increasing `sequenceNumber`).
- It is *polling*, not SSE — there is no `text/event-stream` route in the
  platform.

**Realtime alternative (not wrapped by the SDK):** Socket.IO on the API
with a JWT handshake — join `task:<id>` by emitting `task:subscribe
{ taskId }`, then listen for `task:event`, `approval:created`, and
`deployment:updated`. Replay after a gap:
`GET /v1/tasks/:id/events?afterSequence=N`. Full protocol:
[Hooks & Events](docs/guides/hooks-and-events.md).

### Deployments

| Method | Endpoint |
|---|---|
| `createDeployment(projectId, { provider, environment? })` | `POST /v1/projects/:pid/deploy` → `{ deploymentId, status }` |
| `getDeployment(projectId, deploymentId)` | `GET …/deployments/:did` |
| `listDeployments(projectId)` | `GET …/deployments` |
| `getDeploymentLogs(projectId, deploymentId, stream?)` | `GET …/logs?stream=build` → `{ logs }` |
| `cancelDeployment(projectId, deploymentId)` | `POST …/cancel` |
| `rollbackDeployment(projectId, deploymentId)` | `POST …/rollback` |

### Memory

| Method | Endpoint | Notes |
|---|---|---|
| `queryMemory(projectId, q)` | `GET /v1/projects/:pid/memories?q=…` | unwraps the `{ memories: [...] }` envelope; ≤200 rows |
| `addMemory(projectId, { category, key, value, context, confidence?, source?, references? })` | `POST /v1/projects/:pid/memories` | `category` ∈ 10 values (`coding_convention`, `architecture_decision`, `previous_bug`, …) |

Memory **is** injected into agent context (the worker pulls relevant rows
per goal). Distinct from the searchable-but-not-injected
[Knowledge base](docs/RULES_AND_INSTRUCTIONS.md).

### Checkpoints

| Method | Endpoint | Notes |
|---|---|---|
| `listCheckpoints(taskId)` | `GET /v1/tasks/:id/checkpoints` | |
| `rollbackCheckpoint(checkpointId)` | `POST /v1/checkpoints/:id/rollback` | body `{ confirm: true }` — the API refuses without it; requires a connected bridge owning the files |

---

## Error handling

```typescript
import { SDKError } from "@ai-harness/sdk";

try {
  await client.getTask("nope");
} catch (err) {
  if (err instanceof SDKError) {
    console.error(err.status, err.code, err.message);
    console.error(err.body);   // full API envelope, incl. requestId
  }
}
```

| Field | Meaning |
|---|---|
| `message` | human message extracted from the API envelope (`error.message`) |
| `code` | machine code when present: `VALIDATION_ERROR`, `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR` |
| `status` | HTTP status — **`0` means transport/timeout failure** (no response) |
| `body` | the parsed envelope `{ error: {…}, requestId }` — quote `requestId` in bug reports |

**Retry matrix** (inside `request()`, `maxRetries: 3` → up to 4 attempts):

| Failure | Retried? | Backoff |
|---|---|---|
| `429`, `502`, `503` | yes | `Retry-After` header if sent, else `min(1000·2^n, 10000)` ms |
| network error / timeout / JSON parse failure | yes | same exponential backoff |
| any other non-2xx (`400/401/403/404/409`) | **no** | immediate throw |

Timeouts use a per-request `AbortController` (`timeoutMs`, default 30 s).

(See also [Error handling](#error-handling) for field semantics.)

---

## Multi-surface quickstarts

### CLI

Already built — [`@ai-harness/cli`](CLI_GUIDE.md) is the reference SDK
consumer: env vars in, text/JSON out, exit codes for pipelines.

### CI without the CLI

```typescript
const client = new AiHarnessClient({ baseUrl, token });
const task = await client.createTask({ goal: "Run tests, fail on errors", projectId, agentMode: "BUILD" });
let failed = false;
for await (const ev of client.streamEvents(task.id)) {
  if (ev.eventType === "TOOL_COMPLETED") inspect(ev.payload);
}
failed = (await client.getTask(task.id)).state !== "COMPLETED";
process.exit(failed ? 1 : 0);
```

(Or just use the CLI: `aiharness review --ci --project <id>` and friends.)

### IDE extension

The shipped VS Code extension (`extensions/vscode/`) uses raw `fetch` +
`socket.io-client` rather than the SDK — parity recipe: `POST /v1/tasks`,
subscribe `task:subscribe`, render `task:event`. Note its known gaps in
[Extension Guide](EXTENSION_GUIDE.md#vs-code-extension).

### Webhooks (outbound — REST only, not in the SDK)

When *you* want to be called instead of polling:

```bash
curl -X POST "$API/v1/workspaces/$WS/webhook-subscriptions" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"url":"https://example.com/hook",
       "eventTypes":["task.completed","task.failed","approval.requested"],
       "maxRetries":3}'
```

- 9 event types: `task.completed`, `task.failed`, `deployment.ready`,
  `deployment.failed`, `approval.requested`, `approval.decided`,
  `member.joined`, `member.removed`, `workspace.updated`.
- Signed with `X-Webhook-Signature: sha256=<hmac>` (HMAC-SHA256 over the
  body; verify with your subscription secret), plus `X-Webhook-Event` and
  `X-Webhook-Timestamp`.
- Delivery retries: 5 s → 30 s → 120 s → 600 s (`maxRetries` 0–10).
- Manage/list/test deliveries via the same resource
  (`GET …/webhook-subscriptions/:id/deliveries`, `POST …/test`).

---

## Recipes

### Wait for a plan, then run the revision loop

```typescript
async function waitForPlan(client: AiHarnessClient, taskId: string, planId: string) {
  // 1. poll until the plan exists and the task wants a decision
  for (let i = 0; i < 600; i++) {
    const t = await client.getTask(taskId);
    if (t.state === "WAITING_FOR_APPROVAL") break;
    if (t.state === "FAILED" || t.state === "CANCELLED") throw new Error(t.state);
    await new Promise((r) => setTimeout(r, 2000));
  }
  // 2. steer first, approve second
  await client.revisePlan(taskId, planId, "Prefer a one-file change");
  // ...task returns to PLANNING, later WAITING_FOR_APPROVAL again...
  await client.approvePlan(taskId, planId);
}
```

Plan id: `GET /v1/tasks/:id/plans` (unwrap `.data[0].id`).

### Bulk submission that survives rate limits

```typescript
for (const goal of goals) {
  const task = await client.createTask({ goal, projectId });
  out.push(task.id);
  // 429s are auto-retried by the SDK; catch to pace yourself:
  await new Promise((r) => setTimeout(r, 1200));   // stay under 30/h comfortably
}
```

### Export a full audit trail

```typescript
let after: number | undefined;
const rows: TaskEvent[] = [];
for (;;) {
  const q = new URLSearchParams({ limit: "500" });
  if (after !== undefined) q.set("afterSequence", String(after));
  const page = await fetch(`${base}/v1/tasks/${id}/events?${q}`, { headers })
    .then((r) => r.json()) as { data: TaskEvent[] };
  if (!page.data.length) break;
  rows.push(...page.data);
  after = page.data[page.data.length - 1]!.sequenceNumber;
}
await fs.writeFile("audit.ndjson", rows.map((r) => JSON.stringify(r)).join("\n"));
```

(`streamEvents` is for following along; this pattern is for completeness.)

### Checkpoint safety net

```typescript
const [ckpt] = await client.listCheckpoints(taskId);
if (ckpt) {
  await client.rollbackCheckpoint(ckpt.id);   // { confirm: true } is sent for you
}
```

---

## What the SDK does NOT wrap (escape hatches)

Everything below exists on the API — call it with `fetch` (see
[API Reference](docs/API.md) for schemas):

| Need | Endpoint |
|---|---|
| login / refresh / signup | `POST /v1/auth/{login,refresh,signup}` |
| plan list (for plan ids) | `GET /v1/tasks/:id/plans` |
| verification / diff / context / approvals reads | `GET /v1/tasks/:id/{verification,changes,context,approvals}` |
| export task as markdown/JSON | `GET /v1/tasks/:id/export/{markdown,json}` |
| knowledge base CRUD | `GET|POST /v1/knowledge`, `GET|PUT|DELETE /v1/knowledge/:id` |
| task templates (the "routine" primitive) | `GET|POST /v1/workspaces/:wid/task-templates`, `POST …/:templateId/use` |
| workspace instructions & policy | `GET|POST /v1/workspaces/:wid/instructions`, `PUT /v1/workspaces/:wid/policy` |
| MCP server config | `POST /v1/mcp/servers`, friends (see [MCP Guide](docs/guides/mcp.md)) |
| webhook subscriptions | `POST /v1/workspaces/:wid/webhook-subscriptions` (above) |
| audit log + CSV export | workspace audit endpoints (see [Enterprise Setup](docs/ENTERPRISE_SETUP.md)) |
| API key management | `POST /v1/api-keys` (creation only; keys not yet accepted as credentials) |
| workspace CRUD, members, SSO | see [API Reference](docs/API.md) |
| Socket.IO realtime | see [Hooks & Events](docs/guides/hooks-and-events.md) |

Raw-request helper you can copy:

```typescript
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json.data as T;
}
```

---

## Rate limits you will meet

| Limit | Value | Endpoint family |
|---|---|---|
| Task creation | 30 / hour / user | `POST /v1/tasks` |
| Tool approvals | 120 / minute | `POST /v1/approvals/*` |
| Global | ~100 / minute / IP (configurable) | everything |
| Signups | 5 / hour / IP | `POST /v1/auth/signup` |

`429` responses carry `Retry-After` and are honored by the SDK's retry
pipeline automatically.

---

## Type reference

```typescript
import {
  AiHarnessClient,          // the client class
  SDKError,                 // error with status/code/body
  type SDKConfig, type RequestOptions,
  // payloads
  type Project, type Task, type Session, type Plan, type PlanStep,
  type PlanRejectResponse, type PlanReviseResponse, type ApprovalDecision,
  type TaskEvent, type Deployment, type DeploymentDetails,
  type DeploymentLogResponse, type MemoryEntry, type Checkpoint,
  type CheckpointRestoreResponse, type HealthStatus,
  type SDKErrorResponse, type ListResponse,
} from "@ai-harness/sdk";
```

`agentMode` accepts `"BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX"` — there is
no `"CODE"` mode. Task states are documented in
[Agent Runtime](docs/AGENT_RUNTIME.md).

---

## Concurrency, state, and versioning

- The client is **stateless**: one instance is safe to share across
  concurrent tasks (`Promise.all` over `createTask` is fine). The only
  shared state is your rate-limit budget.
- Reads scale with the API; writes that matter are bounded server-side
  (30 task creations/hour/user). Handle `429` as backpressure, not as an
  error — the SDK already retried at least once before you see it.
- Compatibility: the package versions with the monorepo (`private: true`,
  no semver on npm). Pin by commit/ref; treat method signature changes as
  breaking and read the changelog.
- For deterministic tests, stub `fetch` the way `client.test.ts` does —
  the client uses global `fetch` and nothing else.

---

## FAQ

**Which surface should I build on?**
Humans in a repo → [CLI](CLI_GUIDE.md). Automation in CI → CLI `--ci`.
Product integration → this SDK. External react-and-call-me →
[webhooks](#webhooks-outbound--rest-only-not-in-the-sdk). Editor →
[Extension Guide](EXTENSION_GUIDE.md).

**Why does `streamEvents` poll instead of using websockets?**
Portability: one code path works everywhere `fetch` works. When you need
push, subscribe to Socket.IO yourself — the protocol is small
(`task:subscribe` → `task:event`).

**Do I get every event with `streamEvents`?**
Yes for tasks under an hour: it pages with `afterSequence` (200 per page)
until terminal state. For archival completeness use the NDJSON recipe
above with `limit=500`.

**How do I wait for `WAITING_FOR_APPROVAL` in production code?**
Poll `getTask` every 2–5 s (state machine in
[Agent Runtime](docs/AGENT_RUNTIME.md)), or push via socket
`approval:created`. The SDK deliberately does not own a wait loop.

**Why is `pauseTask` typed `Task` but returns `{ id, pauseRequested }`?**
The API acknowledges the *request*, not the paused state — confirm with
`getTask`. The type is looser than reality; check fields before use.

**Can I use the SDK in the browser?**
Yes if you inject tokens and set CORS-friendly URLs — but tokens in
browser storage are your threat model to own. Server-side is the intended
home.

**Where do I report a bug in an endpoint mapping?**
Every method maps to a route listed in [API Reference](docs/API.md); open
an issue with the method name + `requestId` from the thrown `SDKError.body`.

---

## Related reading

- [CLI Guide](CLI_GUIDE.md) — the same API with flags and exit codes
- [API Reference](docs/API.md) — every endpoint, including the unwrapped ones
- [Hooks & Events](docs/guides/hooks-and-events.md) — socket protocol, event catalog
- [Examples](docs/examples/README.md) — eight end-to-end recipes
- [Getting Started](docs/getting-started.md) — first 30 minutes
