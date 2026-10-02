# Hooks and Events

The observability and automation surface: ordered runtime events over WebSocket, REST polling for recovery, in-process lifecycle hooks, and Prometheus metrics.

Sources: [Agent runtime architecture](../AGENT_RUNTIME.md) §16–§17, [API reference](../API.md), `backend/packages/agent-runtime/src/event-publisher.ts`, `backend/packages/agent-runtime/src/orchestrator.ts`, `backend/apps/api/src/plugins/socket.ts`, `backend/apps/api/src/modules/activity/activity.routes.ts`.

---

## Realtime Event Delivery

### Persist first, then fan out

`EventPublisher.publishAndEmit()` writes the row before anything is broadcast (`backend/packages/agent-runtime/src/event-publisher.ts:86-105`):

```text
publish(input)  ->  prisma.$transaction(insert TaskEvent)  ->  emit(taskId, event)
```

The class comment states the contract: "Persists an ordered event BEFORE publication; clients recover through replay" (`event-publisher.ts:25-30`), matching [Agent runtime architecture](../AGENT_RUNTIME.md) §16 — "Persist event before publication; client can recover through ordered event replay."

The fan-out path:

1. API process: `EventPublisher` is constructed with an emitter that calls `app.publishTaskEvent()` (`backend/apps/api/src/app.ts:184-190`).
2. `publishTaskEvent` publishes `{ taskId, event }` to Redis channel `ai-harness:task-events` (`backend/apps/api/src/plugins/socket.ts:44-51`).
3. Worker runs do the same from their own publisher (`backend/apps/worker/src/worker.ts:112-115`), so events emitted by BullMQ jobs reach every API replica through Redis pub/sub.
4. The Socket.IO plugin subscribes to that channel and emits `"task:event"` into room `task:<taskId>` (`socket.ts:92-101`).

A publication failure never blocks persistence: the emit call is fire-and-forget and failures are logged, not thrown (`app.ts:185-189`, `event-publisher.ts:94-104`).

### Ordered sequence

Sequence numbers are allocated per task (`event-publisher.ts:46-84`):

- inside a `Serializable` transaction,
- under `pg_advisory_xact_lock(hash(taskId))` so concurrent publishers for the same task serialize while different tasks stay parallel (`event-publisher.ts:49-56`),
- as `max(sequenceNumber) + 1` for the task (`event-publisher.ts:57-61`),
- with a unique constraint on `(task_id, sequence_number)` (comment at `event-publisher.ts:28-29`).
- Unique-violation and serialization-failure codes (`P2002`, `P2034`) are retried up to 5 times with jitter (`event-publisher.ts:75-81`).

Payloads pass through `redactValue()` before persistence (`event-publisher.ts:44`). Every persisted event carries `id`, `taskId`, `runId`, `sequenceNumber`, `eventType`, `actorType`, `payload`, `createdAt` (`event-publisher.ts:14-23`), which is the shape Socket.IO clients receive (`event-publisher.ts:95-104`).

### Replay and resume

Server side:

- `EventPublisher.replay(taskId, { fromSequence, toSequence, eventTypes, limit })` returns rows ordered by `sequenceNumber` ascending (`event-publisher.ts:111-147`).
- `getLatestSequence(taskId)` returns the highest sequence, or `-1` when the task has no events (`event-publisher.ts:173-179`).
- `GET /v1/tasks/:taskId/events?afterSequence=N` filters `sequenceNumber > N`, orders ascending, and applies `limit` (`backend/apps/api/src/modules/activity/activity.routes.ts:27-36`).

Client side:

- The socket plugin documents resume explicitly: "Clients subscribe per task after membership verification and resume with `afterSequence` through the REST activity endpoint on reconnect" (`socket.ts:17-23`).
- `frontend/src/lib/use-task-socket.ts` tracks `lastSeqRef`, and on the Socket.IO `"connect"` event re-subscribes and pulls everything after the last seen sequence (`use-task-socket.ts:56-94`).

> **Resolved:** the frontend replay call previously used a nonexistent `/v1/tasks/:taskId/activity` path; it now calls the registered `GET /v1/tasks/:taskId/events?afterSequence=N&limit=500` route (`use-task-socket.ts`).

---

## WebSocket Event Types

Connect with Socket.IO to the API server; authenticate on the handshake with a JWT access token (`docs/API.md` § WebSocket Events):

```typescript
import { io } from "socket.io-client";

const socket = io("http://localhost:4000", {
  auth: { token: "<access_token>" },
});

socket.on("task:event", (event) => {
  console.log(event.eventType, event.payload);
});
```

Event types exactly as documented in [API reference](../API.md):

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

Notes for integrators:

- The server envelope is `{ id, taskId, runId, sequenceNumber, eventType, actorType, payload, createdAt }` (`event-publisher.ts:95-104`); `docs/API.md`'s example reads the implemented field names `eventType` and `payload`.
- The runtime taxonomy actually written to the database is `TASK_EVENT_TYPES` (`backend/packages/domain/src/events.ts:3-36`) and is broader than the table above — e.g. `STATE_CHANGED`, `TOOL_APPROVED`, `TOOL_DENIED`, `REPLAN_STARTED`, `APPROVAL_GRANTED`, `APPROVAL_DENIED`, `APPROVAL_EXPIRED`, `RUN_BLOCKED_BY_REVIEW`. The orchestrator also publishes non-enumerated types such as `TOOL_OBSERVED` (`orchestrator.ts:741`), `SECURITY_SCAN` (`orchestrator.ts:879`), and `CHECKPOINT_ROLLED_BACK` (`checkpoint-manager.ts:201`). Switch on `eventType` defensively.
- A second Socket.IO event, `approval:created`, is emitted to room `workspace:<workspaceId>` when a worker publishes an approval to Redis channel `ai-harness:approval-events` (`socket.ts:102-108`, `backend/apps/worker/src/worker.ts:122`). No handler joins a `workspace:*` room — only `task:<taskId>` (`socket.ts:81`) — so verify room membership before relying on it; approvals are also delivered as ordinary `task:event` traffic via `TOOL_REQUESTED`.
- Membership is enforced at subscribe time: `task:subscribe` joins the room only if the authenticated user is a member of the task's workspace (`socket.ts:66-85`).

---

## REST Fallback

Polling endpoints (tag `activity`) in `backend/apps/api/src/modules/activity/activity.routes.ts`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/tasks/:taskId/events?afterSequence=&limit=` | Ordered event replay / polling (documented in `docs/API.md` as `GET /v1/tasks/:id/events`) |
| `GET` | `/v1/tasks/:taskId/context` | Context packages, newest first |
| `GET` | `/v1/tasks/:taskId/context/:contextPackageId` | One context package |
| `GET` | `/v1/tasks/:taskId/changes` | Tool calls (file changes), ordered by `startedAt` |
| `GET` | `/v1/tasks/:taskId/checkpoints` | Checkpoints, newest first |
| `GET` | `/v1/tasks/:taskId/verification` | Verification results, ordered by `createdAt` |
| `GET` | `/v1/tasks/:taskId/approvals` | Approval requests with their tool call |
| `POST` | `/v1/checkpoints/:checkpointId/rollback` | Confirm-gated rollback (`confirm: true`) |

Query contract (`backend/packages/contracts/src/activity.ts:3-7`): `afterSequence` is a non-negative integer, `limit` is 1–500 with a default of 200. Every read requires a valid token and a workspace role check on the task's workspace (`activity.routes.ts:339-349`); rollback requires `MEMBER` (`activity.routes.ts:217`).

`docs/BACKEND_STRUCTURE.md` lists the same surface under "Activity" and "Approvals".

---

## Lifecycle Hooks

`TaskOrchestrator` exposes an in-process hook bus (`backend/packages/agent-runtime/src/orchestrator.ts:38-60`).

### Registration

```typescript
orchestrator.onHook("beforeToolCall", (ctx) => { /* ... */ });
orchestrator.offHook("beforeToolCall", handler);
```

- `HookEvent` is a closed union of 11 names (`orchestrator.ts:38-49`).
- `HookContext` is `{ taskId, runId, projectId, workspaceId, event, payload? }` (`orchestrator.ts:51-58`).
- Handlers may be sync or async and are awaited sequentially in registration order (`orchestrator.ts:102-112`).
- A throwing handler is caught and logged as `lifecycle hook failed` at warn level — hook failures never fail the run (`orchestrator.ts:106-111`).

These hooks are process-local: they are not exposed over HTTP or WebSocket. One production subscriber ships with the platform — the repo-wiki maintainer registers `afterComplete` at runtime startup (`runtime.ts`) to refresh `.aiharness/wiki/` after each completed run (see the [Wiki Guide](wiki.md)).

### Hooks that fire, with payloads

| Hook | Fires | Payload |
|---|---|---|
| `beforePlan` | Start of `planOnce()`, before route resolution and model invocation | `{ mode }` — the requested mode or `input.agentMode` (`orchestrator.ts:412`) |
| `afterPlan` | After a plan version is persisted, on the direct-execution path (not on the path that parks for plan approval) | `{ planId, version, stepCount }` (`orchestrator.ts:502`) |
| `beforeToolCall` | Immediately before an allowed tool executes on the main step path, after the DESTRUCTIVE pre-step checkpoint. Not fired for an approved tool call replayed by `continueAfterToolDecision()` (`orchestrator.ts:580-584`). | `{ toolName, toolCallId, stepId }` (`orchestrator.ts:715`) |
| `afterToolCall` | After the tool returns with `status === "SUCCEEDED"` (main step path only) | `{ toolName, toolCallId, status, failureCode }` (`orchestrator.ts:717`) |
| `onToolError` | After the tool returns with any status other than `SUCCEEDED` — same payload as `afterToolCall` (main step path only) | `{ toolName, toolCallId, status, failureCode }` (`orchestrator.ts:717`) |
| `beforeVerification` | After verification commands are resolved (plan's `verificationPlan` or auto-inferred), before execution | `{ commandCount }` (`orchestrator.ts:818`) |
| `afterVerification` | After `VerificationEngine.verify()` returns, before failure-driven replanning | `{ results }` — the verification result array, each entry exposing at least `command`, `status`, `output` (`orchestrator.ts:822`, used at `orchestrator.ts:824-829`) |
| `beforeComplete` | After the security scan, immediately before the transition to `COMPLETED` | `{ planId, stepCount, securityFindings }` (`orchestrator.ts:915`) |
| `afterComplete` | After the task state is `COMPLETED` and `RUN_COMPLETED` is published — the repo-wiki maintainer subscribes here | `{ planId, stepCount, verificationPassed }` (`orchestrator.ts:930`) |
| `onReplan` | When a failure triggers a replan attempt | `{ attempt, failureSummary }` (`orchestrator.ts:1521`) |
| `onError` | When the run fails (`handleStageFailure`) — logged with `.catch()` as extra insurance | `{ failureCode, message }` (`orchestrator.ts:1635`) |

All eleven members of `HookEvent` have a `fireHooks()` call site; there is no
"declared but never fired" subset. Handler exceptions are caught and logged
(`lifecycle hook failed`) — they never fail the run.

### Example

```typescript
import { TaskOrchestrator } from "@ai-harness/agent-runtime";

export function attachAuditHooks(orchestrator: TaskOrchestrator): void {
  orchestrator.onHook("beforeToolCall", async (ctx) => {
    const { toolName, toolCallId, stepId } = (ctx.payload ?? {}) as {
      toolName: string;
      toolCallId: string;
      stepId: string;
    };
    await audit.record({
      action: "TOOL_ABOUT_TO_RUN",
      taskId: ctx.taskId,
      runId: ctx.runId,
      metadata: { toolName, toolCallId, stepId },
    });
  });

  orchestrator.onHook("onToolError", (ctx) => {
    const { toolName, status, failureCode } = (ctx.payload ?? {}) as {
      toolName: string;
      status: string;
      failureCode?: string;
    };
    logger.warn({ taskId: ctx.taskId, toolName, status, failureCode }, "tool error hook");
  });
}
```

---

## Subscribing as an Integrator

### Client pattern

From [API reference](../API.md):

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:4000", {
  auth: { token: "<access_token>" },
});

socket.on("task:event", (event) => {
  console.log(event.eventType, event.payload);
});
```

Room subscription is explicit: emit `task:subscribe` with `{ taskId }` after connecting, and `task:unsubscribe` on teardown (`socket.ts:66-89`). Access tokens are verified on handshake; a missing or invalid token fails with `UNAUTHENTICATED` (`socket.ts:53-63`).

### TypeScript example with resume

```typescript
import { io, type Socket } from "socket.io-client";

type TaskEvent = {
  id: string;
  taskId: string;
  runId: string | null;
  sequenceNumber: number;
  eventType: string;
  actorType: "USER" | "SYSTEM" | "AGENT" | "TOOL" | "BRIDGE";
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export function subscribeToTask(apiBase: string, token: string, taskId: string) {
  const socket: Socket = io(apiBase, { auth: { token }, transports: ["websocket"] });
  let lastSequence = -1;

  const handle = (event: TaskEvent) => {
    if (event.sequenceNumber <= lastSequence) return; // dedupe across replay + live
    lastSequence = event.sequenceNumber;
    consume(event);
  };

  socket.on("task:event", handle);

  socket.on("connect", async () => {
    socket.emit("task:subscribe", { taskId });
    if (lastSequence < 0) return;
    const res = await fetch(
      `${apiBase}/v1/tasks/${taskId}/events?afterSequence=${lastSequence}&limit=500`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as { data: TaskEvent[] };
    for (const event of body.data ?? []) handle(event);
  });

  return () => {
    socket.emit("task:unsubscribe", { taskId });
    socket.disconnect();
  };
}
```

Keep the guard `event.sequenceNumber <= lastSequence`: live events can arrive while a replay is in flight.

---

## Metrics

### Prometheus scrape endpoint

`GET /metrics` (`backend/apps/api/src/modules/admin/monitoring.routes.ts:84-100`):

- Unauthenticated by design — "in production, restrict via network policy / API gateway" — and rate-limited to 30 requests / minute (`monitoring.routes.ts:84-85`).
- Content type: `text/plain; version=0.0.4`.
- Always appends process gauges:

```text
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes <rss>
# TYPE process_heap_used_bytes gauge
process_heap_used_bytes <heapUsed>
# TYPE process_uptime_seconds gauge
process_uptime_seconds <uptime>
```

- Then appends `metricsCollector.toPrometheus()` (`monitoring.routes.ts:87,99`), which serializes whatever samples were recorded into `MetricsCollector` as Prometheus lines: counters/gauges as `# TYPE <name> <type>` plus samples with sanitized names and labels, `timer` samples exported as `histogram` (`backend/packages/metrics-collector/src/metrics-collector.ts:82-129`).

> **Current state:** within the API process, `MetricsCollector` is only constructed in `monitoring.routes.ts:12` and no other module records into it, so today the collector-derived section of `/metrics` is empty apart from the process gauges above. If you need request/latency counters, record them into this collector or scrape `/metrics` alongside existing infrastructure metrics.

### Related monitoring endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/metrics` | none (rate-limited) | Prometheus text exposition |
| `GET` | `/v1/admin/metrics?name=` | platform admin | Collected metrics summary, counters, filter by name (`monitoring.routes.ts:105-132`) |
| `GET` | `/v1/admin/health` | platform admin | Aggregated `database` / `redis` / `worker` checks; `503` when unhealthy (`monitoring.routes.ts:58-76`) |
| `GET` | `/healthz` | none (rate limit disabled) | Database liveness; `503` if the DB query fails (`backend/apps/api/src/app.ts:192-202`, `docs/API.md`) |

---

## Related reading

- [Agent runtime architecture](../AGENT_RUNTIME.md) — event contract (§17) and publication failure handling (§16)
- [API reference](../API.md) — WebSocket event table, activity endpoints, error codes
- [Permissions and approvals](../guides/permissions-and-approvals.md) — how `TOOL_REQUESTED` / approval decisions are produced
