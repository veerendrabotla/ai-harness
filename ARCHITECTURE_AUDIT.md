# AI Harness — Architecture Audit

## 1. Current Repository Structure

```
ai-harness/
├── backend/
│   ├── apps/
│   │   ├── api/              → Fastify REST API (primary HTTP entrypoint)
│   │   ├── worker/           → BullMQ background worker (task lifecycle)
│   │   └── bridge-gateway/   → WebSocket gateway (local bridge ↔ cloud)
│   ├── packages/
│   │   ├── contracts/        → API contracts, enums, Zod schemas, DTOs
│   │   ├── shared/           → Env config, errors, crypto, logger, bridge protocol
│   │   ├── database/         → Prisma client singleton + repositories
│   │   ├── domain/           → Task state machine (XState), failure codes
│   │   ├── context-engine/   → Deterministic context assembly with token budget
│   │   ├── permission-engine/→ Tool permission evaluation
│   │   ├── repo-intelligence/→ Static repository analysis
│   │   ├── tool-harness/     → Tool registry + execution pipeline
│   │   ├── model-adapters/   → LLM provider abstraction (Anthropic, OpenAI, Gemini, Ollama)
│   │   ├── multi-agent/      → Specialist agent roles (Supervisor, Planner, Coder, etc.)
│   │   ├── agent-runtime/    → Core orchestration (plan→approve→execute→verify loop)
│   │   ├── agent-observability/ → Execution traces + Prisma persistence
│   │   ├── sandbox-engine/   → Isolated local execution environments
│   │   ├── execution-provider/→ Abstraction for local-bridge vs cloud-sandbox
│   │   ├── deployment-provider/ → Deployment targets (Vercel, Cloudflare, Railway)
│   │   ├── deployment-engine/ → Build + deploy pipeline orchestration
│   │   └── project-memory/   → Long-term project knowledge store
│   └── prisma/               → Database schema
├── frontend/                 → Next.js 15 PWA
├── local_bridge/             → Local machine agent (bridges user machine ↔ cloud)
└── packages/                 → (empty — future shared frontend/backend packages)
```

## 2. Package Dependency Graph

```
LEAF PACKAGES (no internal deps):
  contracts
  shared
  sandbox-engine

NEAR-LEAF PACKAGES:
  domain              → contracts, shared
  database            → shared
  context-engine      → shared, contracts
  permission-engine   → contracts
  repo-intelligence   → contracts, shared (vestigial?)
  project-memory      → shared
  model-adapters      → contracts, shared
  deployment-provider → shared

MID-TIER PACKAGES:
  tool-harness        → contracts, domain, shared
  deployment-engine   → shared
  execution-provider  → shared, sandbox-engine
  multi-agent         → deployment-provider

HUB PACKAGE:
  agent-runtime       → context-engine, contracts, database, domain,
                        model-adapters, multi-agent, permission-engine,
                        project-memory, repo-intelligence, shared,
                        tool-harness, agent-observability

APP CONSUMERS:
  api                 → agent-runtime, contracts, database, deployment-engine,
                        domain, execution-provider, model-adapters,
                        permission-engine, sandbox-engine, shared, tool-harness
  worker              → agent-runtime, contracts, database, deployment-engine,
                        domain, model-adapters, permission-engine, shared, tool-harness
  bridge-gateway      → database, shared
```

**Circular dependencies: NONE.** Clean DAG from leaves to hub.

## 3. Business Logic Location Analysis

### In Routes (acceptable — thin wrappers)
Most API routes follow the pattern: validate → authenticate → authorize → delegate to package → format response. This is correct.

### Business Logic in Packages (correct location)
- Agent orchestration: `agent-runtime/src/orchestrator.ts`
- Task state machine: `domain/src/task-state.ts`
- Tool execution: `tool-harness/src/harness.ts`
- Model routing: `agent-runtime/src/model-router.ts`
- Context assembly: `context-engine/src/engine.ts`
- Permission evaluation: `permission-engine/src/evaluate.ts`
- Deployment lifecycle: `deployment-engine/src/index.ts`

### Business Logic in Lib Files (mixed)
`apps/api/src/lib/` contains 23 utility files. Most are legitimate HTTP-layer utilities:
- `audit.ts` — audit logging helper
- `auth-service.ts` — auth business logic (arguably should be in a package)
- `billing.ts` — billing logic
- `cost-alert-notifications.ts` — notification delivery
- `sso-service.ts` — SSO token exchange
- `two-factor.ts` — 2FA logic
- `scim.ts` — SCIM provisioning

**Issue**: Some of these (auth-service, two-factor, SSO, SCIM) contain business logic that could be extracted into packages for reuse by CLI/SDK.

## 4. Agent Logic Analysis

### What Exists (packages)
- `multi-agent/`: SupervisorAgent, PlannerAgent, CoderAgent, ReviewerAgent, TesterAgent, DevOpsAgent — all as classes with typed interfaces
- `agent-runtime/`: TaskOrchestrator (the main loop), MemoryAwareOrchestrator, MultiAgentOrchestrator, Planner, ModelRouter, ApprovalCoordinator, CheckpointManager, VerificationEngine, EventPublisher

### What's in the API Layer
The worker (`apps/worker/src/worker.ts`) drives the agent runtime via BullMQ jobs. The API routes handle HTTP request/response. Neither contains raw agent logic.

### What's in the Frontend
Zero agent logic. The `/agent` page is a pure control surface — it sends goals to the API and renders events.

**Assessment**: Agent logic is already well-separated into packages. The core runtime is framework-agnostic.

## 5. Tool Runtime Analysis

### What Exists
`tool-harness/` provides:
- `ToolRegistry` class — register, get, list, toModelDefinitions
- `ToolHarness` class — validate → resolve environment → bounded execution → normalized result
- `createDefaultToolRegistry()` — registers 22 tools (filesystem, git, terminal, checkpoint, MCP, HTTP, deploy)

### What's Missing
- No formal `Tool` interface with permission/risk metadata
- No dynamic tool discovery (tools are hardcoded in `createDefaultToolRegistry`)
- No tool-level audit events
- No plugin mechanism for external tools

## 6. Execution Provider Analysis

### What Exists
- `execution-provider/`: `LocalBridgeProvider`, `CloudSandboxProvider`, `DefaultExecutionProviderFactory`
- `sandbox-engine/`: Real filesystem isolation with process management
- `local_bridge/`: Full local machine agent
- Bridge gateway: WebSocket proxy between cloud and local

### What's Simulated
- `CloudSandboxProvider` delegates to `SandboxEngine` which is real filesystem isolation, not Docker containers
- Docker sandbox exists in `apps/worker/src/sandbox.ts` as a composite resolver but is not fully wired

## 7. Security Analysis

### Strong
- AES-256-GCM encryption for secrets (AES-256-GCM, not base64)
- RBAC with workspace roles
- SSRF protection (`isSafeOutboundUrl`)
- Path confinement (`confinePath`)
- Prompt injection defense (`fenceUntrusted`)
- Rate limiting
- Audit logging
- JWT with refresh rotation

### Needs Improvement
- No centralized permission engine for tool execution (permission-engine exists but is only used in agent-runtime)
- No adversarial tests for sandbox escape
- No formal tenant isolation testing
- WebSocket authentication in bridge-gateway uses device tokens but no rate limiting

## 8. Fake/Simulated Implementations

| Package | Class | Purpose | Replacement Needed? |
|---------|-------|---------|-------------------|
| model-adapters | TestAdapter | Deterministic testing | No — legitimate test double |
| project-memory | InMemoryProjectMemoryEngine | Testing/fallback | No — legitimate test double |
| agent-observability | InMemoryTraceCollector | Testing | No — legitimate test double |
| deployment-provider | InMemoryDeploymentProviderRegistry | Testing | No — legitimate test double |
| deployment-provider | InMemoryCredentialManager | Testing | No — legitimate test double |
| sandbox-engine | SandboxEngine | Real filesystem, in-memory registry | Registry could be persistent |

**No fake production implementations detected.** All test doubles are clearly marked and used only in tests.

## 9. What Already Satisfies Target Architecture

| Target Layer | Current Package | Status |
|-------------|-----------------|--------|
| Core Engine | agent-runtime (orchestrator + runtime) | ✅ EXISTS — needs interface formalization |
| Agent Runtime | multi-agent + agent-runtime | ✅ EXISTS — needs plugin mechanism |
| Tool Runtime | tool-harness | ✅ EXISTS — needs formal interface + registry |
| Model Runtime | model-adapters | ✅ EXISTS — clean interface |
| Permission Engine | permission-engine | ✅ EXISTS — needs centralization |
| Context Engine | context-engine | ✅ EXISTS — complete |
| Project Intelligence | repo-intelligence | ✅ EXISTS — complete |
| Project Memory | project-memory | ✅ EXISTS — complete |
| Execution Provider | execution-provider | ✅ EXISTS — needs formalization |
| Deployment Provider | deployment-provider | ✅ EXISTS — complete |
| Observability | agent-observability | ✅ EXISTS — needs event formalization |
| Contracts | contracts | ✅ EXISTS — comprehensive |
| Sandbox | sandbox-engine | ✅ EXISTS — real implementation |
| Bridge | local_bridge + bridge-gateway | ✅ EXISTS — real implementation |

## 10. What Needs Work

### HIGH PRIORITY
1. **Core Engine Interface** — formalize `createEngine()` API
2. **Event System** — canonical event model with persistence/replay
3. **SDK** — `@ai-harness/sdk` for external consumers
4. **CLI** — thin client using core engine
5. **Permission Centralization** — move tool permission checks into a middleware layer

### MEDIUM PRIORITY
6. **API Stabilization** — versioned endpoints, internal model abstraction
7. **Session Independence** — sessions should work without web UI
8. **Checkpoint Formalization** — first-class checkpoint objects
9. **Frontend Code Cleanup** — deduplicate timeAgo, formatNumber, consolidate types
10. **Verification Engine** — auto-detect and run project-appropriate checks

### LOW PRIORITY
11. **Extension System** — plugin architecture for agents/tools/models
12. **IDE Extension Interfaces** — prepare stable contracts
13. **CI Agent Mode** — `--ci` flag for headless operation
14. **MCP Platform** — first-class MCP extensibility

## 11. Key Architectural Insight

The codebase is **closer to the target architecture than it appears**. The packages already form a clean layered architecture. The main gap is **interface formalization** — the `AgentRuntime` interface exists but isn't documented as a public SDK surface. The `ToolRegistry` exists but tools aren't dynamically pluggable. The `ExecutionProvider` exists but isn't documented.

The most impactful work is:
1. Documenting and stabilizing existing interfaces
2. Extracting business logic from API lib files into reusable packages
3. Creating the SDK as a thin wrapper around existing interfaces
4. Creating the CLI as a thin client
5. Formalizing the event system
