# MCP Integration Guide

How AI Harness connects external **Model Context Protocol (MCP)** tool servers, registers their tools, health-checks them, and gates every call behind the permission engine.

Everything below is read from the repository sources. File references use `file:line` so you can jump straight to the implementation.

Related reading: [API reference](../API.md) · [Extension guide](../../EXTENSION_GUIDE.md) · [CLI guide](../../CLI_GUIDE.md) · [README](../../README.md)

---

## 1. What MCP is in Harness

MCP is an open protocol that lets a client discover and invoke tools exposed by an external process or HTTP service. In AI Harness it is one of three ways an agent reaches the outside world (the others being `http.request` and the Local Bridge filesystem/git tools).

The pieces involved:

| Layer | Location | Responsibility |
|---|---|---|
| REST surface | `backend/apps/api/src/modules/mcp/mcp.routes.ts` | Register / list / update / delete servers, enable-disable per workspace, run enable-time tool discovery |
| Persistence | `McpServer` model (`backend/prisma/schema.prisma`) | Stores `transportType`, `status` (`DISABLED` \| `ACTIVE` \| `ERROR`) and an **encrypted** config blob; `discoveredTools` cache |
| Runtime registry | `backend/packages/mcp-platform/src/registry.ts` | Connection lifecycle, JSON-RPC dispatch, per-server audit log |
| Transport | `backend/packages/mcp-platform/src/stdio-transport.ts` | Long-lived local child process over stdin/stdout |
| Bridge transport | `backend/apps/worker/src/sandbox.ts` (`stdioViaBridge`) | One-shot JSON-RPC executed on the owner's connected Local Bridge |
| Tool gateway | `backend/packages/tool-harness/src/definitions.ts` | The single `mcp.call` tool the agent invokes |
| Health sweeper | `backend/apps/worker/src/worker.ts` | Pings `ACTIVE` HTTP/SSE servers and flips failures to `ERROR` |

Design point: MCP servers are **configuration**, not code. They are registered through the API like provider connections are — you never edit a config file to add one. Their `config` payload is AES-256-GCM encrypted at rest and is never returned by any endpoint (`mcp.routes.ts:343` — *"encryptedConfig is never returned."*).

---

## 2. Supported transports

`transportType` is the value you send to the API; `transport` is the value the runtime registry uses internally (`backend/packages/mcp-platform/src/types.ts:1`, `:22`).

| `transportType` (API) | `transport` (runtime) | Wire protocol | Where it executes |
|---|---|---|---|
| `HTTP` | `streamable-http` | JSON-RPC 2.0 over HTTP `POST` | API / worker process |
| `SSE` | `sse` | JSON-RPC 2.0 over HTTP `POST` (same code path as HTTP) | API / worker process |
| `STDIO` | `stdio` | Line-delimited JSON-RPC over a child process `stdin`/`stdout`, **or** one-shot JSON-RPC through the Local Bridge | The server owner's machine |

### 2.1 HTTP (`streamable-http`)

`MCPRegistry.establishConnection` (`registry.ts:455-499`) opens the connection with a single JSON-RPC `initialize` call:

```json
{
  "jsonrpc": "2.0",
  "id": 1717000000000,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "ai-harness", "version": "1.0.0" }
  }
}
```

- `config.url` is required (`registry.ts:438` — a missing URL still yields a `connected` result at the registry layer, but the API rejects registration without it, see §3).
- `config.apiKey`, when present, is sent as `authorization: Bearer <apiKey>` (`registry.ts:209-212`, `:458-461`).
- Timeout defaults to **30 000 ms**, overridable with `config.timeout` (`registry.ts:207`, `:456`).
- Retry policy defaults are `maxRetries: 3`, `backoffMs: 1000`, `maxBackoffMs: 30 000` (`types.ts:183-187`) and drive exponential reconnect in `connectServer` (`registry.ts:83-91`).

### 2.2 SSE

SSE servers are registered with `transportType: "SSE"` and are mapped to `transport: "sse"` when the worker builds the runtime config (`resolvers.ts:120`).

> **Verified caveat:** `MCPRegistry.establishConnection` and `callMethod` do **not** branch on `transport` for non-STDIO servers — both HTTP and SSE issue `fetch(config.url, { method: "POST", ... })` with a JSON-RPC body (`registry.ts:462`, `:525`). There is no `EventSource` / long-lived SSE stream client anywhere in `backend/packages/mcp-platform/src/`. If your server requires a true `text/event-stream` handshake, it must also accept JSON-RPC over plain HTTP `POST`.

### 2.3 STDIO

There are **two distinct implementations**, and which one runs depends on the call site.

**(a) Long-lived local child process** — `backend/packages/mcp-platform/src/stdio-transport.ts`

Used by `MCPRegistry` / `MCPConnectionManager` when the registry is instantiated in a process that owns the binary (e.g. a worker running on the same machine as the MCP server).

- Spawns with `spawn(command, args, { env: { ...process.env, ...serverEnv } })` (`stdio-transport.ts:69`) — your `config.env` is merged **on top of** the parent environment.
- `stdout` is the protocol: read line-by-line via `node:readline`, each line one JSON-RPC message (`stdio-transport.ts:86-89`).
- `stderr` is logs and is never parsed as protocol (`stdio-transport.ts:78-84`). **A server that writes to `console.log` will corrupt the protocol stream.**
- `initialize` → `notifications/initialized` handshake on start (`stdio-transport.ts:179-195`).
- Crashes auto-restart with exponential backoff, capped by `retryPolicy.maxRetries` (default 5 for the stdio transport, `stdio-transport.ts:157`).
- `stop()` ends stdin, then `SIGTERM`, then `SIGKILL` after 2 s (`stdio-transport.ts:321-343`).

**(b) One-shot JSON-RPC through the connected Local Bridge** — this is the path production uses.

- **Tool discovery on enable:** `backend/apps/api/src/lib/mcp-discovery.ts` finds the owner's bridge with `status: "CONNECTED"` and calls `BridgeGatewayClient.execute(bridgeId, "mcp.stdio", { command, args, rpc: { method: "tools/list" } })` (result cached in Redis for 10 min, see §4.1).
- **Tool execution:** `backend/apps/worker/src/sandbox.ts` (`stdioViaBridge`) rejects a non-`ACTIVE` server with `POLICY_DENIED` (**F-13: disabled servers cannot receive calls**), resolves the task owner's `CONNECTED` bridge, decrypts `config.command` / `config.args`, and sends a **single** JSON-RPC frame `{ jsonrpc:"2.0", id:1, method:"tools/call", params:{...} }` over gateway `POST /execute`, with a 20 s discovery timeout / definition timeout for calls.
- If no bridge is connected: `errors.bridgeDisconnected("STDIO MCP requires a connected Local Bridge")`.
- Note the layering: the base resolver's `mcpExecutor` rejects STDIO with `UNSUPPORTED — "STDIO MCP transport is not supported yet"` (`resolvers.ts`), but the composite resolver intercepts STDIO *before* delegating (`sandbox.ts`), so calls do work whenever a bridge is present.

**Bridge requirement for STDIO:** the Local Bridge agent needs filesystem + git and does not run on mobile (see the platform-support table in the [README](../../README.md)).

---

## 3. Enabling a server

### 3.1 REST endpoints

The MCP rows documented in [docs/API.md](../API.md) are, listed exactly:

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/mcp/servers` | List MCP servers |
| `POST` | `/v1/mcp/servers` | Register MCP server |

`backend/apps/api/src/modules/mcp/mcp.routes.ts` additionally exposes these routes (all catalogued in [docs/API.md](../API.md)):

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/mcp/servers/:serverId` | Get one server (owner-only) |
| `PATCH` | `/v1/mcp/servers/:serverId` | Update name / status / config |
| `DELETE` | `/v1/mcp/servers/:serverId` | Delete a server |
| `POST` | `/v1/workspaces/:workspaceId/mcp/:serverId/enable` | Enable in a workspace (runs discovery) |
| `POST` | `/v1/workspaces/:workspaceId/mcp/:serverId/disable` | Disable in a workspace |
| `GET` | `/v1/workspaces/:workspaceId/mcp` | List servers linked to a workspace |

All of them require `Authorization: Bearer <access_token>`; the workspace routes additionally require `VIEWER` (list) or `OWNER` (enable/disable) via `app.requireWorkspaceRole`.

### 3.2 Required fields

Registration body is validated twice — Fastify's JSON schema and the Zod `createMcpServerRequestSchema` (`backend/packages/contracts/src/integrations.ts:5-9`):

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, 1–120 chars |
| `transportType` | enum | required, one of `STDIO`, `HTTP`, `SSE` |
| `config` | object | required; free-form record, validated per transport |

Transport-specific validation in `mcp.routes.ts:49-57`:

- `transportType: "STDIO"` → `config.command` **must** be a non-empty string, otherwise `VALIDATION_ERROR: "STDIO transport requires config.command"`.
- `transportType: "HTTP"` or `"SSE"` → `config.url` **must** be a string, otherwise `VALIDATION_ERROR: "<TYPE> transport requires config.url"`.

Recognised `config` keys (all optional unless noted above):

| Key | Used by | Meaning |
|---|---|---|
| `command` | STDIO (required) | Binary to spawn, or to exec on the bridge |
| `args` | STDIO | argv array |
| `env` | STDIO | Extra environment merged over `process.env` |
| `url` | HTTP, SSE (required) | JSON-RPC endpoint |
| `headers` | HTTP, SSE | Extra request headers (e.g. `authorization`) |
| `apiKey` | HTTP, SSE | Sent as `Bearer` by the registry |
| `timeout` | all | Per-request timeout in ms (default 30 000) |
| `retryPolicy` | all | `{ maxRetries, backoffMs, maxBackoffMs }` |

### 3.3 Status lifecycle

```
POST /v1/mcp/servers ──► DISABLED ──enable(workspace)──► ACTIVE
                            ▲                              │
                            └── disable / failed ping ─────┴──► ERROR
```

- **New servers always start `DISABLED`** — explicit enablement is enforced by design (`mcp.routes.ts:65`, PRD F-13).
- Enabling flips status to `ACTIVE` if discovery succeeded (or immediately for STDIO); a failed HTTP/SSE `tools/list` flips it to `ERROR` (`mcp.routes.ts:297-303`).
- `PATCH` may only move a server to `ACTIVE`/`DISABLED`, and **not** while it is already `ACTIVE` (`mcp.routes.ts:114`).
- `DELETE` is refused with `CONFLICT` while the server is linked and enabled in any workspace (`mcp.routes.ts:141-144`) — disable it everywhere first.
- Server-level `status` reflects whether **any** workspace has the server enabled (`mcp.routes.ts:242`).

---

## 4. Tool discovery

Discovery happens in two places: at enable time (cached), and on demand (runtime).

### 4.1 Enable-time discovery

`toggleMcp` in `mcp.routes.ts` delegates to `backend/apps/api/src/lib/mcp-discovery.ts`:

- **STDIO** → one-shot `tools/list` through the owner's connected bridge via `BridgeGatewayClient.execute(..., "mcp.stdio", { command, args, rpc })`, 20 s timeout.
- **HTTP / SSE** → direct `POST config.url` with `{ method: "tools/list", params: {} }`, 10 s `AbortSignal.timeout`.
- **Caching** → results are cached in Redis under `mcp:discovery:{serverId}` for **10 minutes**, tagged with the SHA-256 of the decrypted config: a config change produces a different hash and misses naturally, `PATCH` with a new config and `DELETE` invalidate the key explicitly, and failures are never cached. Repeated enable/disable cycles therefore skip the bridge round-trip / upstream call until the TTL expires or the config changes.
- Up to **200** `{ name, description }` entries are persisted to `mcpServer.discoveredTools`.
- Discovery failure logs `[MCP] Tool discovery failed:` and leaves `discovered = null` (the STDIO branch still reports `ACTIVE`; HTTP/SSE report `ERROR`).

### 4.2 Runtime discovery

`MCPRegistry.discoverTools(serverId)` (`registry.ts:140-150`) issues `tools/list` over the live connection and returns `MCPTool[] = { name, description?, inputSchema?, annotations? }` (`types.ts:68-73`). `resources/list` and `prompts/list` are exposed the same way (`registry.ts:152-174`). Discovery failures are swallowed and return `[]` with a pino warning.

### 4.3 How MCP tools reach the Tool Registry

**Important and verified:** individual MCP tools are *not* injected as first-class entries into the Tool Registry. The registry exposes exactly one integration tool, **`mcp.call`** (`backend/packages/tool-harness/src/definitions.ts:74-79`):

```ts
def("mcp.call", "Invoke a tool exposed by an enabled MCP server via the proxy", "EXTERNAL",
  z.object({
    serverId: z.string().uuid(),
    mcpToolName: z.string().min(1).max(200),
    args: z.record(z.unknown()).default({}),
  })),
```

- `environment: "INTERNAL"` for `mcp.call` (`definitions.ts:31-33`), so it never touches the filesystem bridge.
- `riskLevel: "EXTERNAL"` → permission default is `ASK` (see §6).

**Schema validation** runs on every invocation in `ToolHarness.execute` (`backend/packages/tool-harness/src/harness.ts:38-47`): the input is `safeParse`d against the Zod schema, and a mismatch returns a non-retryable failure `VALIDATION_ERROR — "Tool input failed schema validation: <paths>"` before any network call. Model-facing tool listings are produced by `registry.ts:99` via `zodToJsonSchema(t.inputSchema)`.

So the flow is:

```
agent proposes mcp.call {serverId, mcpToolName, args}
        │
        ├─ ToolHarness: zod schema validation          (definitions.ts schema)
        ├─ Permission Engine: ALLOW / ASK / DENY       (BEFORE the harness runs)
        ├─ composite resolver: STDIO → bridge, else    (sandbox.ts:109-119)
        ├─ MCPRegistry.callTool → JSON-RPC tools/call  (registry.ts:176-234)
        └─ SecretRegistry.maskOutput + redactValue     (harness.ts:105-108)
```

---

## 5. Health checks

### 5.1 The worker sweeper (persistent, database-backed)

Every sweep cycle of `backend/apps/worker/src/worker.ts:284-315`:

```ts
const activeServers = await db.mcpServer.findMany({
  where: { status: "ACTIVE", transportType: { not: "STDIO" } },
  take: 50,
});
```

For each server it decrypts the config, `POST`s `{ method: "tools/list" }` to `cfg.url` with `AbortSignal.timeout(8_000)`, then:

- `res.ok` → `status: "ACTIVE"`
- non-OK response **or thrown error** → `status: "ERROR"` plus the warning log `mcp server marked ERROR after failed health check` (`worker.ts:304-311`).

**STDIO servers are deliberately excluded** (`transportType: { not: "STDIO" }`) — they have no URL to ping and their liveness is the bridge's.

### 5.2 In-process checks (`MCPConnectionManager`)

`connection-manager.ts:113-125` starts a 30-second `setInterval` per connected server that calls `registry.healthCheck(serverId)`. For STDIO it inspects `transport.isConnected` (`stdio-transport.ts:46-48`); for HTTP/SSE it derives `healthy | unhealthy | unknown` from the in-memory `state.status` (`registry.ts:313-325`) — it does **not** re-issue a network request. The authoritative network ping is the worker sweeper in §5.1.

### 5.3 Reading health

`GET /v1/mcp/servers` exposes the `status` field. For per-action history, `MCPRegistry.getAuditLog({ serverId, action, limit })` (`registry.ts:369-379`) records `connect | disconnect | tool_call | resource_read | prompt_get | error`.

---

## 6. Security

### 6.1 Permissions still gate every MCP call

Registration and enablement do **not** grant execution rights. Every `mcp.call` flows through the Permission Engine *before* the Tool Harness is invoked (`harness.ts:14-15`: *"Permission evaluation happens in the runtime BEFORE this harness is invoked; the harness never grants permissions itself."*).

`mcp.call` carries `riskLevel: "EXTERNAL"`, and the default when no policy rule matches is:

```ts
EXTERNAL: {
  outcome: "ASK",
  reason: "No matching rule; EXTERNAL tools require approval by default",
},
```

(`backend/packages/permission-engine/src/evaluate.ts:23-26`)

Evaluation order (`evaluate.ts:6-13`):

1. Explicit **`DENY`** rules always win — DENY is absolute.
2. A live TASK-scope approval for the same tool grants `ALLOW`.
3. Most-specific matching rule (exact name, then `*` wildcard) decides.
4. Safe defaults per risk level: `READ → ALLOW`, `WRITE`/`DESTRUCTIVE`/`EXTERNAL → ASK`.

Two hard-coded escalations worth knowing:

- An `ALLOW` rule can never silently auto-approve `DESTRUCTIVE` risk (`evaluate.ts:85-90`).
- Writes to `.env*` files are escalated `ALLOW → ASK` regardless of policy (`evaluate.ts:93-97`).

`ASK` creates an expiring approval; a human resolves it via `POST /v1/approvals/:approvalId/approve` or `POST /v1/approvals/:approvalId/deny` (`backend/apps/api/src/modules/approvals/approvals.routes.ts:110`). Expired approvals are swept by the worker and their pending tool calls are flipped to `DENIED` (`worker.ts:249-279`).

### 6.2 Server-level permissions inside `mcp-platform`

`MCPServerPermissions` (`types.ts:47-51`) narrows each surface independently:

```ts
{ tools: "none" | "read" | "write" | "admin",
  resources: "none" | "read" | "write" | "admin",
  prompts: "none" | "read" | "admin" }
```

`registry.callTool` throws `Tool access denied for server <id>` when `permissions.tools === "none"` (`registry.ts:182-184`); `readResource` and `getPrompt` behave the same (`registry.ts:242-244`, `:263-265`). Defaults are `{ tools: "read", resources: "read", prompts: "read" }` (`types.ts:189-193`).

### 6.3 Status is a policy gate

The worker's `mcpExecutor` refuses any server whose status is not `ACTIVE` — `resolvers.ts:101-103` throws `Error("MCP server is disabled")` with `code: "POLICY_DENIED"`. So `ERROR` (including a failed health ping) blocks execution exactly like an explicit disable.

### 6.4 Secrets and output redaction

- MCP `config` blobs are AES-256-GCM encrypted with `ENCRYPTION_KEY` at write time and decrypted only in-memory for a single call (`mcp.routes.ts:64`, `worker.ts:292-296`, `sandbox.ts:210`). They are never serialised back in a response.
- The in-memory `SecretRegistry` (`backend/packages/shared/src/secret-registry.ts`) auto-masks registered secret values in all tool output. `maskOutput(output)` replaces every occurrence of a secret with `***KEY***` (`secret-registry.ts:87-95`).
- `ToolHarness` applies both `redactValue(...)` and `getSecretRegistry().maskOutput(...)` to successful output (`harness.ts:105-108`) and to failure messages (`harness.ts:136-141`).
- `injectEnv(command)` only yields secrets whose **key name appears in the command**, so one tool call cannot dump the whole vault (`secret-registry.ts:58-68`).
- Audit metadata for MCP events passes through `redactValue` before persistence (`mcp.routes.ts:310`).

### 6.5 Outbound URL policy

`mcp.call` is `INTERNAL`, not `http.request`, so it is not subject to the SSRF guard `isSafeOutboundUrl` that `http.request` hits (`harness.ts:49-64`). Treat `config.url` as a trusted operator-supplied value: anything you register is reachable from the worker.

---

## 7. Worked example: register an HTTP MCP server and use it in a task

### 7.1 Sign in

```bash
TOKEN=$(curl -sS -X POST http://localhost:4000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r '.data.accessToken')
```

Access tokens expire after 15 minutes (`ACCESS_TOKEN_TTL_SECONDS=900` in `.env.example`); rotate with `POST /v1/auth/refresh`.

### 7.2 Register the server

```bash
curl -sS -X POST http://localhost:4000/v1/mcp/servers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "name": "team-docs-mcp",
    "transportType": "HTTP",
    "config": {
      "url": "http://localhost:8931/mcp",
      "timeout": 30000
    }
  }'
```

Response (`201`) — note there is no `config` in it:

```json
{ "data": { "id": "0f1e2d3c-...-uuid", "name": "team-docs-mcp",
            "transportType": "HTTP", "status": "DISABLED",
            "createdAt": "2026-09-25T10:00:00.000Z",
            "updatedAt": "2026-09-25T10:00:00.000Z" },
  "meta": { "requestId": "…" } }
```

### 7.3 Enable it in a workspace (this runs `tools/list`)

```bash
curl -sS -X POST "http://localhost:4000/v1/workspaces/$WORKSPACE_ID/mcp/$SERVER_ID/enable" \
  -H "Authorization: Bearer $TOKEN"
```

Requires the `OWNER` role on that workspace. Inspect the outcome:

```bash
curl -sS "http://localhost:4000/v1/mcp/servers" -H "Authorization: Bearer $TOKEN" | jq '.data[] | {name, transportType, status}'
```

`"status": "ERROR"` here means the enable-time `tools/list` did not return a healthy response — check the API log for `[MCP] Remote tool discovery failed:`.

### 7.4 Use its tool inside a task

Create a task the way `scripts/e2e-agent-run.ts:97-106` does:

```bash
curl -sS -X POST http://localhost:4000/v1/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{
    \"workspaceId\": \"$WORKSPACE_ID\",
    \"projectId\": \"$PROJECT_ID\",
    \"goal\": \"Summarise the onboarding doc served by the team-docs MCP server.\",
    \"constraints\": \"Read-only; cite the source tool output.\",
    \"selectedModelMode\": \"ROUTED\"
  }"
```

When the agent decides to use the MCP server it proposes:

```json
{ "toolName": "mcp.call",
  "input": { "serverId": "0f1e2d3c-...-uuid", "mcpToolName": "search_docs",
             "args": { "query": "onboarding" } } }
```

Because the risk level is `EXTERNAL`, this lands as an approval. Approve it:

```bash
curl -sS -X POST "http://localhost:4000/v1/approvals/$APPROVAL_ID/approve" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'
```

Follow progress over WebSocket (`task:event` → `TOOL_APPROVAL_REQUIRED`, `TOOL_STARTED`, `TOOL_COMPLETED` / `TOOL_FAILED`) or by polling `GET /v1/tasks/:id/events`.

### 7.5 STDIO variant

```bash
curl -sS -X POST http://localhost:4000/v1/mcp/servers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "name": "local-filesystem-mcp",
    "transportType": "STDIO",
    "config": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
  }'
```

Enabling this requires a bridge with `status: "CONNECTED"` owned by the registering user — otherwise discovery logs `[MCP] Tool discovery failed:` and the server ends up `ERROR` (the STDIO branch still records `ACTIVE` when discovery returns no list, so also verify the bridge directly: `GET /v1/bridges`).

---

## 8. Not available yet — do not document or depend on this

> **`.well-known/mcp/server-card.json` does NOT exist.** There is no `.well-known` directory, no server-card route, and no MCP registry advertisement endpoint anywhere in this repository. It appears only as a *gap* in `docs/DOCUMENTATION_BENCHMARK.md:97` (`⬜ No`). Do not link to it, do not tell users to fetch it, and do not imply auto-discovery of Harness as an MCP provider — neither is implemented.

Other honest limitations to keep in mind when writing about MCP support:

- No `.well-known` discovery of Harness itself.
- SSE has no dedicated streaming client (§2.2).
- MCP tools surface to the model only through the single `mcp.call` gateway tool (§4.3), so a server with 50 tools still presents as one tool plus a `mcpToolName` argument.
- `serializeServer` (`mcp.routes.ts:326-344`) returns only `id`, `ownerId`, `name`, `transportType`, `status`, `createdAt`, `updatedAt` — **`discoveredTools` is written to the database but never serialised back out**, so there is currently no API route to read the cached tool list.

---

## 9. Source map

| Concern | File |
|---|---|
| REST routes | `backend/apps/api/src/modules/mcp/mcp.routes.ts` |
| Request contracts | `backend/packages/contracts/src/integrations.ts` |
| Status enum | `backend/packages/contracts/src/enums.ts` (`MCP_SERVER_STATUSES`) |
| Registry + JSON-RPC dispatch | `backend/packages/mcp-platform/src/registry.ts` |
| Types, permissions, retry policy | `backend/packages/mcp-platform/src/types.ts` |
| STDIO child-process transport | `backend/packages/mcp-platform/src/stdio-transport.ts` |
| 30 s in-process health interval | `backend/packages/mcp-platform/src/connection-manager.ts` |
| Health sweeper + orphan/stuck recovery | `backend/apps/worker/src/worker.ts` |
| `mcp.call` executor (HTTP/SSE) | `backend/apps/worker/src/resolvers.ts` |
| `mcp.call` STDIO-via-bridge | `backend/apps/worker/src/sandbox.ts` |
| `mcp.call` tool definition + Zod schema | `backend/packages/tool-harness/src/definitions.ts` |
| Schema validation & output masking | `backend/packages/tool-harness/src/harness.ts` |
| ALLOW / ASK / DENY evaluation | `backend/packages/permission-engine/src/evaluate.ts` |
| Secret masking | `backend/packages/shared/src/secret-registry.ts` |
| Unit tests | `backend/packages/mcp-platform/src/mcp-platform.test.ts` |

Next: [API reference](../API.md) · [troubleshooting](../troubleshooting.md) · [extension guide](../../EXTENSION_GUIDE.md)
