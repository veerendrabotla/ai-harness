# AI Harness — Architecture

## Overview

AI Harness is a **reusable AI Software Engineering Platform** with one independent core engine and multiple clients. The same underlying engine powers:

1. **Web AI Builder** — Bolt/Lovable-like prompt-to-app experience
2. **AI Coding Agent** — Claude Code/Cursor-like coding assistant
3. **CLI Agent** — Terminal-based agent (`aiharness` command)
4. **IDE Extension** — VS Code/JetBrains integration (planned)
5. **CI/CD Agent** — Automated review and test runner
6. **Third-party SDK** — `@ai-harness/sdk` for external applications

## Architecture Principles

1. **One Engine, Many Clients** — All clients share the same core engine, agent runtime, tool runtime, and execution providers
2. **Framework Independence** — Core packages have no dependency on Next.js, React, Fastify, or any specific framework
3. **Plugin Architecture** — Tools, agents, models, and execution providers are pluggable via well-defined interfaces
4. **Security by Default** — Every sensitive operation passes through the permission engine
5. **Real Implementations** — No simulated deployments, fake health checks, or placeholder infrastructure

## Package Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CLIENTS                           │
│  Web App │ CLI │ IDE Extension │ SDK Consumer        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                  API LAYER                           │
│  Fastify REST API │ WebSocket Gateway │ Bridge GW   │
│  (apps/api)       │ (apps/api)        │ (apps/bridge-gateway) │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                CORE ENGINE                           │
│  @ai-harness/core — Engine interface                 │
│  @ai-harness/events — Canonical event model          │
│  @ai-harness/sdk — External API client               │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              AGENT RUNTIME                           │
│  @ai-harness/agent-runtime — Orchestration           │
│  @ai-harness/multi-agent — Specialist agents         │
│  @ai-harness/context-engine — Prompt assembly        │
│  @ai-harness/project-memory — Long-term memory       │
│  @ai-harness/repo-intelligence — Project analysis    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               TOOL RUNTIME                           │
│  @ai-harness/tool-harness — Tool registry + exec     │
│  @ai-harness/permission-engine — Central permissions  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│             MODEL RUNTIME                            │
│  @ai-harness/model-adapters — LLM abstraction        │
│  (Anthropic, OpenAI, Gemini, Ollama, Test)           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│           EXECUTION PROVIDERS                        │
│  @ai-harness/execution-provider — Provider interface │
│  @ai-harness/sandbox-engine — Local isolation        │
│  Local Bridge (apps/bridge-gateway + local_bridge/)  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│            DEPLOYMENT PROVIDERS                      │
│  @ai-harness/deployment-provider — Provider interface│
│  @ai-harness/deployment-engine — Pipeline            │
│  (Vercel, Cloudflare, Railway, Self-hosted)          │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              INFRASTRUCTURE                          │
│  @ai-harness/database — Prisma client                │
│  @ai-harness/shared — Env, crypto, errors, logger    │
│  @ai-harness/contracts — API contracts, enums        │
│  @ai-harness/domain — Task state machine             │
│  @ai-harness/agent-observability — Traces             │
└─────────────────────────────────────────────────────┘
```

## Package Dependency Graph

```
LEAF PACKAGES (no internal deps):
  contracts
  shared
  sandbox-engine

NEAR-LEAF PACKAGES:
  domain → contracts, shared
  database → shared
  context-engine → shared, contracts
  permission-engine → contracts
  repo-intelligence → contracts, shared
  project-memory → shared
  model-adapters → contracts, shared
  deployment-provider → shared

MID-TIER PACKAGES:
  tool-harness → contracts, domain, shared
  deployment-engine → shared
  execution-provider → shared, sandbox-engine
  multi-agent → deployment-provider
  events → contracts

HUB PACKAGES:
  agent-runtime → context-engine, contracts, database, domain,
                  model-adapters, multi-agent, permission-engine,
                  project-memory, repo-intelligence, shared,
                  tool-harness, agent-observability
  core → agent-runtime, contracts, shared
  sdk → contracts, events

APP CONSUMERS:
  api → core, agent-runtime, contracts, database, deployment-engine,
        domain, execution-provider, model-adapters, permission-engine,
        sandbox-engine, shared, tool-harness, events, sdk
  worker → agent-runtime, contracts, database, deployment-engine,
           domain, model-adapters, permission-engine, shared, tool-harness
  bridge-gateway → database, shared
```

**Circular dependencies: NONE.** Clean DAG from leaves to hub.

## Core Engine API

```typescript
import { createEngine } from "@ai-harness/core";

const engine = createEngine({
  prisma: prismaClient,
  logger: logger,
  onEvent: (taskId, event) => console.log(event),
});

// Create and run a task
const task = await engine.createTask({
  goal: "Build a login page with OAuth",
  projectId: "proj_123",
  workspaceId: "ws_456",
});

// Subscribe to events
const unsub = engine.subscribe(task.taskId, (event) => {
  console.log(`${event.type}: ${JSON.stringify(event.data)}`);
});

// Approve plan
await engine.approvePlan(task.taskId, planId);

// Pause/cancel
await engine.pauseTask(task.taskId);
await engine.cancelTask(task.taskId);
```

## Tool Runtime API

```typescript
import type { Tool, ToolContext, ToolResult } from "@ai-harness/tool-harness";

const myTool: Tool = {
  identity: {
    name: "custom-linter",
    description: "Custom linting tool",
    version: "1.0.0",
    category: "custom",
  },
  schema: {
    input: { type: "object", properties: { path: { type: "string" } } },
    output: { type: "object", properties: { errors: { type: "array" } } },
  },
  permissions: {
    riskLevel: "LOW",
    requiresApproval: false,
    allowedInSandbox: true,
    allowedInBridge: true,
    allowedInRemote: true,
  },
  validate(input) {
    if (!input || typeof input !== "object" || !("path" in input)) {
      return { valid: false, errors: ["path is required"] };
    }
    return { valid: true };
  },
  async execute(input, context): Promise<ToolResult> {
    // Run custom linting logic
    return { success: true, output: { errors: [] }, durationMs: 100 };
  },
};
```

## Model Runtime API

```typescript
import { ModelRuntime } from "@ai-harness/model-adapters";

const runtime = new ModelRuntime({
  adapters: [anthropicAdapter, openaiAdapter, ollamaAdapter],
  defaultProvider: "ANTHROPIC",
  timeoutMs: 30_000,
  maxRetries: 2,
});

// Generate
const response = await runtime.generate(
  { stage: "PLANNING", modelIdentifier: "claude-sonnet-4-20250514", ... },
  { id: "conn_1", providerType: "ANTHROPIC", credential: "sk-..." }
);

// Stream
const result = await runtime.stream(
  { stage: "IMPLEMENTATION", modelIdentifier: "gpt-4o", ... },
  { id: "conn_2", providerType: "OPENAI", credential: "sk-..." },
  { onDelta: (text) => process.stdout.write(text) }
);
```

## Permission Engine API

```typescript
import { CentralizedPermissionEngine } from "@ai-harness/permission-engine";

const engine = new CentralizedPermissionEngine();

// Evaluate a permission request
const decision = engine.evaluate({
  resource: "git",
  action: "push",
  riskLevel: "HIGH",
  userRole: "MEMBER",
  environment: "bridge",
});

if (decision.requiresApproval) {
  // Show approval dialog
}
if (!decision.allowed) {
  // Block the action
}
```

## Event System

All important operations emit typed events:

```typescript
import { ALL_EVENTS } from "@ai-harness/events";

// Event types include:
// RUN_CREATED, RUN_STARTED, RUN_COMPLETED, RUN_FAILED
// PLAN_CREATED, PLAN_APPROVAL_REQUIRED, PLAN_APPROVED
// TOOL_REQUESTED, TOOL_APPROVAL_REQUIRED, TOOL_STARTED, TOOL_COMPLETED, TOOL_FAILED
// CHECKPOINT_CREATED, CHECKPOINT_RESTORED
// VERIFICATION_STARTED, VERIFICATION_COMPLETED
// DEPLOYMENT_STARTED, DEPLOYMENT_COMPLETED, DEPLOYMENT_FAILED
```

## SDK API

```typescript
import { AiHarnessClient } from "@ai-harness/sdk";

const client = new AiHarnessClient({
  baseUrl: "https://api.aiharness.dev",
  apiKey: "your-api-key",
});

// Create a task
const task = await client.createTask({
  goal: "Build a REST API for user management",
  projectId: "proj_123",
});

// Stream events
for await (const event of client.streamEvents(task.id)) {
  console.log(event.type, event.data);
}

// Approve plan
await client.approvePlan(task.id, planId);

// Deploy
const deployment = await client.createDeployment("proj_123", {
  provider: "vercel",
});
```

## Security Architecture

- **Authentication**: JWT with refresh token rotation
- **Authorization**: RBAC with workspace roles (OWNER, ADMIN, MEMBER, VIEWER)
- **Encryption**: AES-256-GCM for secrets (never plain base64)
- **Permission Engine**: Centralized deny-first policy evaluation
- **Path Confinement**: Prevents path traversal in file operations
- **SSRF Protection**: Blocks requests to private/internal addresses
- **Prompt Injection Defense**: Randomized delimiters for untrusted content
- **Rate Limiting**: Per-user, per-endpoint rate limits with Redis persistence
- **Audit Logging**: All sensitive operations logged with actor, action, resource
- **Tenant Isolation**: All queries scoped to workspace/project

## Database Schema

Key entities (see `backend/prisma/schema.prisma` for full schema):

- **User** — Authentication, profiles, platform role
- **Workspace** — Tenant boundary, billing, settings
- **Project** — Repository, deployment config, memory
- **Task** — Goal, state machine, agent mode
- **TaskRun** — Individual execution attempts
- **TaskPlan** — Planned steps for a task
- **PlanStep** — Individual step in a plan
- **ToolCall** — Tool execution records
- **ToolApproval** — Pending tool approvals
- **Deployment** — Deployment records and status
- **Checkpoint** — Filesystem snapshots for rollback
- **ExecutionTrace** — Full observability traces
- **ProjectMemory** — Long-term project knowledge
- **AuditLog** — Security audit trail
- **ProviderConnection** — AI model provider credentials
- **DeploymentCredential** — Deployment provider credentials
- **McpServer** — MCP server configurations
- **Bridge** — Local machine bridges
- **SsoConfig** — SSO/SAML configuration
- **RateLimit** — Rate limiting state

## Running the Platform

```bash
# Start infrastructure
docker compose up -d

# Start API server
cd backend/apps/api && npm run dev

# Start worker
cd backend/apps/worker && npm run dev

# Start bridge gateway
cd backend/apps/bridge-gateway && npm run dev

# Start frontend
cd frontend && npm run dev

# Run tests
npx vitest run

# TypeScript check
npx tsc --noEmit -p tsconfig.check.json  # backend
cd frontend && npx tsc --noEmit           # frontend
```
