# AI Harness Documentation

AI Harness is a model-independent agentic development environment: a control plane where AI coding agents understand projects, assemble bounded context, draft structured plans, request human approval, execute policy-controlled tools, verify their work, and leave a complete auditable trail.

This documentation hub links every guide, reference, and deep-dive document in the repository.

---

## Choose your surface

| If you want to… | Start here |
|---|---|
| Run the web app and drive agent tasks | [Getting Started](getting-started.md) |
| Write goals and prompts that get better results | [Prompt Guide](PROMPT_GUIDE.md) |
| Find your situation and copy a runnable goal | [Use Cases](USE_CASES.md) |
| Set workspace rules, policies, and constraints | [Rules & Instructions](RULES_AND_INSTRUCTIONS.md) |
| Compare model costs and pick plans | [Models & Pricing](MODELS_AND_PRICING.md) |
| Understand how runs, permissions, and context work | [Core Concepts](concepts.md) |
| Use the CLI | [CLI Guide](../CLI_GUIDE.md) |
| Integrate via the SDK | [SDK Guide](../SDK_GUIDE.md) |
| Build an IDE extension | [Extension Guide](../EXTENSION_GUIDE.md) |
| Automate in CI/CD | [Examples](examples/README.md) |
| Connect external tool servers | [MCP Guide](guides/mcp.md) |
| Deploy and operate the platform | [Self-Hosting Guide](guides/self-hosting.md) |
| Diagnose a problem | [Troubleshooting](troubleshooting.md) |

---

## Documentation map

### Start here

| Document | What it covers |
|---|---|
| [Getting Started](getting-started.md) | Install, run, and complete your first agent task |
| [Core Concepts](concepts.md) | Tasks, runs, planning, permissions, checkpoints, context, events |
| [Examples](examples/README.md) | Eight worked recipes from bug fixes to rollback |
| [Troubleshooting](troubleshooting.md) | Symptom → cause → fix diagnostics hub |

### Guides

| Document | What it covers |
|---|---|
| [Prompt Guide](PROMPT_GUIDE.md) | Six prompt rules, what reaches the model, prompt library |
| [Rules & Instructions](RULES_AND_INSTRUCTIONS.md) | The four steering tiers, policy enforcement, caps, migration playbook |
| [Use Cases](USE_CASES.md) | 26 templated workflows: goal, context, artifacts, permissions |
| [Models & Pricing](MODELS_AND_PRICING.md) | 50-model price matrix, plan quotas, cost controls, worked examples |
| [Permissions & Approvals](guides/permissions-and-approvals.md) | ALLOW / ASK / DENY, policies, approval flow, security scan gate |
| [Context & Memory](guides/context-and-memory.md) | Budgeted context assembly, repo map, compaction, project memory |
| [Models & Providers](guides/models-and-providers.md) | Provider credentials, model routing, fallbacks, cost tracking |
| [Hooks & Events](guides/hooks-and-events.md) | Realtime events, replay, lifecycle hooks, metrics |
| [MCP](guides/mcp.md) | Connect HTTP/SSE/STDIO Model Context Protocol servers |
| [Self-Hosting](guides/self-hosting.md) | Single-node, production containers, GCP/Terraform, scaling |

### Reference

| Document | What it covers |
|---|---|
| [API Reference](API.md) | REST endpoints, envelopes, WebSocket events |
| [Agent Runtime](AGENT_RUNTIME.md) | Runtime architecture, state machine, execution loop |
| [Benchmarks](BENCHMARKS.md) | Reproducible load/replay results, methodology, leaderboard format |
| [Backend Structure](BACKEND_STRUCTURE.md) | Per-package layout and database schema |
| [Tool Guide](../TOOL_GUIDE.md) | Tool registry, risk levels, execution environments |
| [CLI Guide](../CLI_GUIDE.md) | CLI commands and flags |
| [SDK Guide](../SDK_GUIDE.md) | SDK client usage and recipes |
| [Architecture](../ARCHITECTURE.md) | High-level system tree and guarantees |

### Product & process

| Document | What it covers |
|---|---|
| [PRD](PRD.md) | Personas, product principles, problem statement |
| [App Flow](APP_FLOW.md) | Task lifecycle and frontend/backend flows |
| [Tech Stack](TECH_STACK.md) | Versions and technology choices |
| [Frontend Guidelines](FRONTEND_GUIDELINES.md) | Design tokens and UI conventions |
| [Security](../SECURITY.md) | Security posture and controls |
| [Changelog](../CHANGELOG.md) | Release history |
| [Roadmap](../TODO_NEXT_PHASE.md) | Phased roadmap and execution log |
| [Contributing](../CONTRIBUTING.md) | Development process rules |

### Advanced / internal

| Document | What it covers |
|---|---|
| [Agent Guide](../AGENT_GUIDE.md) | The five-agent architecture and task lifecycle |
| [Platform Guide](../PLATFORM_GUIDE.md) | Deployment surfaces |
| [Decisions](../DECISIONS.md) | Spec-conflict resolutions and rationale |
| [Implementation Status](../IMPLEMENTATION_STATUS.md) | Honest per-subsystem status |
| [External Deployment Checklist](../EXTERNAL_DEPLOYMENT_CHECKLIST.md) | Cloud environment, secrets, run commands |

---

## Reading paths

**New user (30 minutes):** [Getting Started](getting-started.md) → [Core Concepts](concepts.md) → [Examples](examples/README.md)

**Integrator (1 hour):** [API Reference](API.md) → [SDK Guide](../SDK_GUIDE.md) → [Hooks & Events](guides/hooks-and-events.md) → [MCP](guides/mcp.md)

**Operator / platform engineer:** [Self-Hosting](guides/self-hosting.md) → [Troubleshooting](troubleshooting.md) → [Security](../SECURITY.md)

**Contributor:** [Architecture](../ARCHITECTURE.md) → [Backend Structure](BACKEND_STRUCTURE.md) → [Agent Runtime](AGENT_RUNTIME.md) → [Contributing](../CONTRIBUTING.md)

---

## For LLM agents

A machine-readable index of every document is available at [`/llms.txt`](../llms.txt) in the repository root. Fetch individual markdown files directly — all documentation is plain GitHub-flavored markdown with no gated content.
