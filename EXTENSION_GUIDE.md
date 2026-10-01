# Extension Guide

"Extensions" in AI Harness sit at three different altitudes, and the
difference matters: **the extension system** (a typed manifest + lifecycle
registry in `@ai-harness/extension-system`), **the mechanisms that actually
ship capability today** (MCP servers, custom tools, hooks, webhooks), and
**client-side add-ons** (the VS Code extension). This guide documents all
three — including exactly which parts are wired into production and which
are architecture waiting for a loader.

---

## Which extension mechanism do you want?

| You want to… | Use | Status |
|---|---|---|
| Give the agent a new external capability (API, browser, DB) | [MCP server](#recipe-a--mcp-server) | **Works today** — config in UI, permission-gated `mcp.call` |
| Add an in-process tool the orchestrator can invoke | [Custom tool](#recipe-b--custom-tool-in-code) (tool-harness) | **Works today** — code change + registry |
| React to run lifecycle moments (before plan, after tool…) | [Hook bus](#recipe-c--lifecycle-hooks) | **Works today** — in-process, currently zero subscribers |
| Be notified from outside the platform | [Outbound webhook](#recipe-d--outbound-webhook) | **Works today** — 9 event types, HMAC, retries |
| Add a deployment target or model provider | Provider registries (`deployment-provider`, `model-adapters`) | **Works today** — code-level registration |
| Drive tasks from your editor | [VS Code extension](#vs-code-extension) | **Ships, with known gaps** (below) |
| Package tools + agents + permissions as one distributable | Extension manifest + registry | **Architecture-level** — see [What is wired today](#what-is-wired-today) |

---

## The extension system

### Extension types

The manifest union (`types.ts`) is exactly ten values — some referenced by
other docs with different spellings, these are the real ones:

| `type` | Intent | Wired in production? |
|---|---|---|
| `tool` | Register extra tools for the orchestrator | **Partially** — definitions are consumed (see below) |
| `agent` | Pluggable agent roles | No (tests only) |
| `model` | Pluggable model providers | No (the real providers live in `model-adapters`) |
| `mcp-server` | MCP server packaging | No (MCP is configured via its own REST, not extensions) |
| `execution-provider` | Where tools execute | No (execution-provider package is separate) |
| `deployment-provider` | Deploy targets | No (deployment-provider registry is separate) |
| `verification-provider` | Verification backends | No |
| `ui-panel` | Frontend panels | No (no frontend loader) |
| `command` | CLI/IDE commands | No (the CLI has no extension loader) |
| `memory` | Memory backends | No |

### Manifest reference

```typescript
interface ExtensionManifest {
  name: string;                    // registry key, unique (duplicate → throw)
  version: string;
  description: string;
  author: string;
  type: ExtensionType;             // the ten values above
  capabilities: {                  // OBJECT, not an array
    tools?: string[]; agents?: string[]; models?: string[];
    mcpServers?: string[]; executionProviders?: string[];
    deploymentProviders?: string[]; verificationProviders?: string[];
    uiPanels?: string[]; commands?: string[];
  };
  permissions: {                   // OBJECT with scoped tiers
    filesystem?: "none" | "read" | "write" | "admin";
    network?:    "none" | "read" | "write" | "admin";
    database?:   "none" | "read" | "write" | "admin";
    secrets?:    "none" | "read" | "admin";         // note: no "write" tier
    git?:        "none" | "read" | "write" | "admin";
    deployment?: "none" | "read" | "write" | "admin";
    mcp?:        "none" | "read" | "write" | "admin";
    ui?:         "none" | "read" | "write" | "admin";
  };
  dependencies?: { name: string; version: string; optional?: boolean }[];
  minPlatformVersion: string;      // required field — not yet validated at load
  maxPlatformVersion?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}
```

> Earlier revisions of this guide showed `capabilities: ["…"]` and
> `permissions: ["tool:execute"]`. Those were wrong — both are **objects**.

Interfaces an extension can implement:

```typescript
interface Extension {
  manifest: ExtensionManifest;
  activate(context: ExtensionContext): Promise<void> | void;
  deactivate(): void | Promise<void>;
  healthCheck?(): Promise<ExtensionHealth> | ExtensionHealth;
}

interface ToolExtension extends Extension {
  getToolDefinitions(): ToolDefinition[];      // { name, description, category, riskLevel, inputSchema }
  executeTool(name: string, input: unknown, ctx: ExtensionContext): Promise<unknown>;
}
// AgentExtension: getAgentDefinition() + executeAgent(): AsyncGenerator
// ModelExtension:  getModelProviders()
```

`ExtensionContext = { workspaceId, projectId?, taskId?, userId, userRole }`.

### Lifecycle and registry

Six states: `registered → activating → active → deactivating → inactive`,
plus `error`.

```typescript
import { InMemoryExtensionRegistry } from "@ai-harness/extension-system";

const registry = new InMemoryExtensionRegistry();
registry.register(myToolExtension);            // validates required deps exist
await registry.activateAll(context);           // topological order; cycles throw
registry.listByType("tool");                   // queries: get/list/isActive/…
await registry.checkHealth("my-extension");    // healthCheck() or healthy-if-active
await registry.deactivate("my-extension");     // deactivates dependents first
```

Semantics (all unit-tested in `extension-system.test.ts`):

- **Dependencies:** `register` fails if a required dependency is missing;
  `activateAll` sorts topologically and throws `Circular dependency
  detected` on cycles; optional deps are skipped.
- **Activation failure** marks that extension `error`/`unhealthy` and
  continues — it does not abort the batch.
- **Deactivation order** is the reverse of activation; deactivating an
  active extension with dependents pulls them down first.
- The registry is `InMemoryExtensionRegistry` — process-local, not
  persisted, not shared across workers.

### What is wired today

Honest consumption map (file:line available in
[Implementation Status](IMPLEMENTATION_STATUS.md)):

| Piece | Status |
|---|---|
| Registry construction | Built **empty** in the agent runtime (`agent-runtime/src/runtime.ts`) and handed to the orchestrator |
| `ToolExtension.getToolDefinitions()` | **Consumed** — `syncExtensionTools()` registers them with the tool harness at run time (30 s timeout, 100 KB output cap, `INTERNAL` environment), mapping risk: `LOW→READ`, `MEDIUM→WRITE`, `HIGH→DESTRUCTIVE`, `CRITICAL→EXTERNAL` |
| `ToolExtension.executeTool()` | **Never called in production** (tests only) — registered extension tools execute through the tool harness path |
| `agent` / `model` definitions | No production consumer |
| Manifest `permissions` / version fields | Declared, validated by types — **not enforced anywhere yet** |
| Production `register()` calls | **None** — no loader reads manifests from disk/DB; the registry only fills when code registers at boot |
| Frontend / API / CLI extension loading | None |

So: the *contracts* are real and tested, the *plumbing from a manifest to a
running platform* is the missing piece. Build extensions as code you
register at boot (or use MCP, which needs no code changes).

### Registries that ARE wired (the practical extension points)

Four plug points accept new implementations through **code** today — no
manifest required:

| Registry | Add by | Registered in |
|---|---|---|
| Tools | `tool-harness` registry (direct) or `ToolExtension` definitions | worker boot + `syncExtensionTools()` per run |
| Model providers | `model-adapters` implementation + adapter config | runtime construction |
| Deployment targets | `deployment-provider` implementation | API deployment routes |
| External capabilities | MCP server config rows | REST / Settings UI |

Each is a TypeScript interface with a concrete factory — grep the package
name for its `register(` call site to find the seam. They are the
supported way to extend the platform until the manifest loader exists.

### Security model

- **No sandbox.** Extensions run in-process inside the worker with full
  Node privileges. Treat `activate()` like any other server startup code.
- `manifest.permissions` is a **declaration for a future enforcer** — today
  the actual guard is the workspace policy engine (ALLOW/ASK/DENY per tool
  call, `.env*` write escalation, risk-level defaults).
- Practical hardening: run the worker as an unprivileged container, keep
  extension code in-repo (code review = your supply chain), and put
  anything network-facing behind an MCP server config (encrypted at rest,
  workspace-scoped, audit-logged).

---

## Recipe A — MCP server

The working "install a capability" path: configuration only, no code
changes. MCP servers are configuration rows, not extension objects — create
them in **Settings → MCP** or REST:

```bash
curl -X POST "$API/v1/mcp/servers" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"github","transport":"stdio","command":"npx",
       "args":["-y","@modelcontextprotocol/server-github"],
       "env":{"GITHUB_TOKEN":"…"},"enabled":true}'
```

Transports: `stdio`, `sse`, `streamable-http` (plus bridge-relayed
commands on the local-machine path). The agent reaches every server through
the single `mcp.call` tool, which is policy-gated like any other tool;
tools are auto-discovered on connect. Full reference:
[MCP Guide](docs/guides/mcp.md).

## Recipe B — custom tool in code

For tools that must run inside the platform (not via MCP):

1. Define the tool with `name`, `description`, `riskLevel`
   (`READ|WRITE|DESTRUCTIVE|EXTERNAL`), JSON-schema inputs, and a handler —
   see [Tool Guide](TOOL_GUIDE.md#adding-custom-tools).
2. Register it with the tool harness before runs start; the orchestrator's
   `syncExtensionTools()` does the equivalent for `ToolExtension`
   definitions.
3. Tool names are what policy globs match (`mytool.*`), so publish your
   naming convention alongside the tool.

### Worked example: a `ToolExtension` end to end

```typescript
import type { ToolExtension } from "@ai-harness/extension-system";

const jiraTool: ToolExtension = {
  manifest: {
    name: "acme-jira",
    version: "1.0.0",
    description: "Fetch and transition Jira issues from agent runs",
    author: "acme-platform",
    type: "tool",
    capabilities: { tools: ["jira.get", "jira.transition"] },
    permissions: { network: "write", filesystem: "none" },   // objects, not arrays
    dependencies: [],
    minPlatformVersion: "0.1.0",
  },
  async activate(ctx) {
    if (!process.env.JIRA_TOKEN) throw new Error("JIRA_TOKEN missing"); // fail → state: error
  },
  async deactivate() {},
  getToolDefinitions() {
    return [
      {
        name: "jira.get",
        description: "Fetch one issue by key",
        category: "external",
        riskLevel: "READ",                 // → policy default ALLOW
        inputSchema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
      },
      {
        name: "jira.transition",
        description: "Move an issue to another status",
        category: "external",
        riskLevel: "EXTERNAL",             // → policy default ASK
        inputSchema: {
          type: "object",
          properties: { key: { type: "string" }, status: { type: "string" } },
          required: ["key", "status"],
        },
      },
    ];
  },
  async executeTool(name, input, ctx) {
    // NOTE: not invoked by the production orchestrator today — the
    // registered definition is executed through the tool-harness path.
    return { ok: true, name, input, ctx };
  },
};

// at worker boot:
registry.register(jiraTool);
await registry.activateAll({ workspaceId, userId, userRole: "MEMBER" });
```

What happens at run time: `syncExtensionTools()` picks up the two
definitions, registers them with the tool harness (30 s timeout, 100 KB
output cap, `INTERNAL` environment), and the agent can now call `jira.get`
— which your workspace policy governs like any other tool. Add
`ALLOW jira.get` / `ASK jira.transition` rules if you want explicit
control; the risk defaults already do the sane thing.

**Registration checklist** — before you call `register()`:

- [ ] `manifest.name` unique and namespaced (`acme-*`); duplicates throw.
- [ ] `capabilities.tools` lists exactly the tool names you return.
- [ ] `riskLevel` honest (it drives policy defaults).
- [ ] `inputSchema` complete — the harness validates `required` fields.
- [ ] Required `dependencies` registered first (or `activateAll` fails).
- [ ] `activate()` idempotent; failures are non-fatal but mark you `error`.
- [ ] Policy globs decided for the new names; document them for admins.

## Recipe C — lifecycle hooks

The orchestrator exposes an in-process hook bus — eleven events, all firing
in current builds:

`beforePlan`, `afterPlan`, `beforeToolCall`, `afterToolCall`,
`onToolError`, `beforeVerification`, `afterVerification`, `beforeComplete`,
`afterComplete`, `onReplan`, `onError`.

```typescript
orchestrator.onHook("afterToolCall", async (ctx: HookContext, payload) => {
  if (payload.tool === "terminal.run") await notifySlack(ctx.taskId, payload);
});
```

Caveats: the bus is **process-local**, has **no HTTP/socket exposure**, and
currently ships with **zero subscribers** — it is for code you maintain
inside the worker, not for external plugins. (Docs elsewhere still claim
some of these never fire; they do — call sites exist for all eleven.)

### Hook catalog

Every hook receives `HookContext { taskId, runId, projectId, workspaceId, event, payload? }`:

| Hook | Fires when | Typical use |
|---|---|---|
| `beforePlan` / `afterPlan` | plan drafted / persisted | lint or stamp the plan |
| `beforeToolCall` / `afterToolCall` | around every tool invocation | metrics, extra guards, enrichment |
| `onToolError` | a tool throws | alerting, auto-classification |
| `beforeVerification` / `afterVerification` | verification gate | custom gates, report sinks |
| `beforeComplete` / `afterComplete` | run finalization | notification, cache warm-up |
| `onReplan` | a replan was requested | budget watchdogs |
| `onError` | run-level failure | last-resort telemetry |

Exceptions thrown by a subscriber follow the run's failure path — keep
hooks fast and defensive.

## Recipe D — outbound webhook

For anything external reacting to platform events (the "routine" primitive
for automation):

```bash
curl -X POST "$API/v1/workspaces/$WS/webhook-subscriptions" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"url":"https://ci.example.com/on-ai-harness",
       "eventTypes":["task.completed","approval.requested"],"maxRetries":3}'
```

Signed `X-Webhook-Signature: sha256=<hmac>`; retries 5/30/120/600 s.
Event catalog and verifier snippet:
[SDK Guide](SDK_GUIDE.md#webhooks-outbound--rest-only-not-in-the-sdk).

## VS Code extension

`extensions/vscode/` — commands (`ai-harness.connect`, `.newTask`,
`.approve`, `.deny`, `.openChat`, `.showDiagnostics`), task tree + chat
views. It talks raw REST + Socket.IO with a JWT, **not** the SDK.

Known gaps (as of this writing — use at your own pace):

- Subscribes to events the server does not emit (`task:created`,
  `approval:requested`, `diagnostics`, `chat:message` …); the real server
  events are `task:event`, `approval:created`, `deployment:updated`.
- Emits `subscribe:tasks` / `chat:send`; the server expects
  `task:subscribe` / `task:unsubscribe`.
- Default port 4010 (gateway) vs the API's 4000.

Until those are reconciled, drive the API from the extension's own
diagnostics view or fall back to [CLI](CLI_GUIDE.md) /
[SDK](SDK_GUIDE.md).

---

## Skills vs Artifacts vs Routines

Competing products package reusable behavior under these names. AI Harness
has **real equivalents but no identically-named features** — this is the
honest taxonomy.

| Concept | What it means | AI Harness equivalent | Exists under that name? |
|---|---|---|---|
| **Skills** (Claude) | Portable, typed instruction packages a model loads on demand (`SKILL.md`) | Closest stack: workspace **instructions** (versioned steering text) + **task templates** (reusable goal+mode+config) + **MCP servers** (capability packages) | ❌ no skill entity, loader, or marketplace — acknowledged future work |
| **Knowledge** (Devin) | Curated facts the agent recalls | **Project memory** — injected into context (`getRelevant()` per goal), typed category/key/value/context/confidence | ✅ exists (as *memory*, not "knowledge") |
| **Knowledge base** (ours) | Searchable reference entries | `GET /v1/knowledge` — `DOCUMENT | CODE_SNIPPET | LINK | NOTE`, workspace-scoped, UI + search | ✅ exists, **but not auto-injected into prompts** |
| **Playbooks / Routines** (Devin, Lovable) | Repeatable multi-step workflows | **Task templates** (`POST …/task-templates/:id/use` instantiates a task + bumps `usageCount`) + plan `verificationPlan` commands + outbound **webhooks** for event-driven runs | ✅ templates & webhooks exist; ❌ no cron/scheduled routines |
| **Artifacts** (Claude, Lovable) | First-class outputs of a run | Results surface as: task **export** (`/export/markdown`), **changes** diff, **verification** results, **checkpoints**, file **uploads**, deployment **logs** | ⚠️ no `Artifact` entity — plus an internal in-memory `SharedArtifact` channel between sub-agents that does not persist |
| **Cross-project referencing** (Lovable) | Share skills/memory across projects | Project memory is **single-project**; knowledge + templates are workspace-scoped (cross-project by sharing, not by reference) | ⚠️ partial |
| **Marketplace / publishing** (all) | Install third-party packs | None — packages are private; distribution = repo + MCP config | ❌ |

### Which feature to reach for, by migration habit

| You used to… | Reach for |
|---|---|
| Drop a `SKILL.md` in Claude | Workspace instructions + a task template (goal text carries the procedure) |
| Save Devin Playbook | Task template (`Settings → Task Templates` → use) |
| Query Devin Knowledge | Project memory (it *is* injected) or Knowledge base (search-only) |
| Wire a Lovable skill | MCP server (config-only capability) or custom tool (in-process) |
| Automate on an event | Outbound webhook (+ CI via the CLI for pipelines) |
| Attach a generated file | Task export / changes / verification endpoints — cite them in your own store |

### What does not exist (planned, not shipped)

`SKILL.md` adoption, an artifacts entity, scheduled/cron routines, a
skills/extension marketplace, and cross-project memory references. See the
[roadmap](TODO_NEXT_PHASE.md) — do not design against them yet.

---

## Publishing status

- All extension-related packages are **private workspace packages** —
  there is no npm distribution, no discovery, no install command.
- Internal distribution today: register at boot in code, ship via the
  monorepo, or configure an MCP server from any published MCP package
  (those *can* come from npm — `npx` handles them).
- The old "npm publish your extension" section of this guide described a
  flow that does not exist; removed.

---

## Best practices

1. Prefer **MCP** for anything with a network boundary — no worker code,
   audit-logged, permission-gated.
2. Give every tool a **stable, namespaced name** (`gitlab.*`) so policy
   globs can allow/deny it cleanly.
3. Declare honest `riskLevel` on tools — policy defaults key off it
   (`READ` auto-allows, `DESTRUCTIVE` asks).
4. Keep `activate()` idempotent and fast; it runs in the worker's startup
   path if you register it there.
5. Test extension manifests against the unit tests' expectations
   (`extension-system.test.ts` is the executable spec).
6. Don't rely on `minPlatformVersion` enforcement — it is declared but not
   validated yet; own compatibility yourself.

---

## FAQ

**Can I ship an extension as an npm package?**
Not through any built-in mechanism — the packages are private and there is
no discovery/install flow. Ship MCP server *commands* (those run via
`npx`), or contribute code to the monorepo.

**Why doesn't my manifest's `permissions` block anything?**
It is declarative today: nothing reads it for enforcement. Real guards are
the workspace policy engine and the process/container you run the worker in.

**Do extensions work across workers?**
Only MCP config (DB-backed) and registries filled at boot in *every*
process that needs them. `InMemoryExtensionRegistry` state is per-process.

**Can an extension add a frontend panel?**
The `ui-panel` type exists; there is no frontend loader yet. Real UI
extension today = the VS Code extension against the REST/socket API.

**How do I test one?**
`extension-system.test.ts` is the executable spec — copy its register /
activate / health / deactivate patterns. Tool definitions can additionally
be validated by running a sandbox task and checking `TOOL_*` events.

**What is the difference between an extension and an MCP server?**
Extensions are in-process code with lifecycle and manifests; MCP servers
are out-of-process config rows reached through one gateway tool. Prefer MCP
unless you need the worker's process.

**Where did "publish to npm" go?**
Removed — that flow never existed in code. See
[Publishing status](#publishing-status).

---

## Related reading

- [MCP Guide](docs/guides/mcp.md) — the working extension mechanism, deep
- [Tool Guide](TOOL_GUIDE.md) — custom tool registry and risk tiers
- [Hooks & Events](docs/guides/hooks-and-events.md) — event catalog + socket protocol
- [Rules & Instructions](docs/RULES_AND_INSTRUCTIONS.md) — steering tiers (the skill stand-in)
- [SDK Guide](SDK_GUIDE.md) — webhooks and API escape hatches
- [Architecture](ARCHITECTURE.md) — where registries live in the system tree
