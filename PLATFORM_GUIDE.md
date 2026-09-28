# AI Harness — Platform Guide

## What is AI Harness?

AI Harness is an **AI-native software development platform** that combines:
- AI App Builder (prompt-to-app)
- AI Coding Agent (autonomous coding)
- Development Environment (web-based IDE)
- Agent Control Plane (multi-agent orchestration)
- Session Platform (portable AI sessions)

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full architectural overview.

### Key Packages

| Package | Purpose |
|---------|---------|
| `@ai-harness/core` | Engine interface |
| `@ai-harness/agent-runtime` | Orchestration |
| `@ai-harness/tool-harness` | Tool execution |
| `@ai-harness/model-adapters` | LLM abstraction |
| `@ai-harness/permission-engine` | Security |
| `@ai-harness/events` | Event system |
| `@ai-harness/sdk` | External API |
| `@ai-harness/cli` | CLI interface |
| `@ai-harness/extension-system` | Plugin system |

## Getting Started

### Quick Start

```bash
# Clone and install
git clone <repo-url>
cd ai-harness
npm install

# Start infrastructure
docker compose up -d

# Start services
cd backend/apps/api && npm run dev
cd frontend && npm run dev
```

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_harness
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=your-secret-at-least-32-chars
ENCRYPTION_KEY=base64-encoded-32-byte-key
BRIDGE_INTERNAL_TOKEN=your-internal-token

# Optional
SENTRY_DSN=https://...
RESEND_API_KEY=re_...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
```

## Features

### 1. Multi-Agent System

- Supervisor, Planner, Coder, Reviewer, Tester, DevOps agents
- Automatic agent selection based on task requirements
- Inter-agent communication and delegation

### 2. Tool System

- Filesystem, terminal, git, browser, MCP, deployment tools
- Permission-based execution
- Risk classification and approval workflow

### 3. Model System

- Anthropic, OpenAI, Google Gemini, Ollama adapters
- Model routing and fallback
- Streaming and token tracking

### 4. Memory System

- Project-specific knowledge store
- Architecture decisions, conventions, lessons learned
- Automatic retrieval and reinforcement

### 5. Execution System

- Local Bridge (user's machine)
- Cloud Sandbox (Docker containers)
- Remote Server (SSH/K8s)

### 6. Deployment System

- Vercel, Cloudflare, Railway, Self-hosted
- Encrypted credential storage
- Health checks and rollback

### 7. Security System

- JWT authentication with refresh rotation
- RBAC workspace roles
- AES-256-GCM encryption
- Centralized permission engine
- Audit logging

## API Reference

### REST API

Base URL: `http://localhost:4000`

```bash
# Authentication
POST /v1/auth/register
POST /v1/auth/login
POST /v1/auth/refresh

# Workspaces
GET /v1/workspaces
POST /v1/workspaces

# Projects
GET /v1/workspaces/:id/projects
POST /v1/workspaces/:id/projects

# Tasks
POST /v1/tasks
GET /v1/tasks/:id
POST /v1/tasks/:id/pause
POST /v1/tasks/:id/resume
POST /v1/tasks/:id/cancel

# Plans
POST /v1/tasks/:id/plans/:planId/approve
POST /v1/tasks/:id/plans/:planId/reject
POST /v1/tasks/:id/plans/:planId/revise

# Approvals
POST /v1/approvals/:id/approve
POST /v1/approvals/:id/deny

# Deployments
POST /v1/projects/:id/deploy
GET /v1/deploy/:id

# Health
GET /v1/health
```

### WebSocket

```javascript
// Connect to task events
const ws = new WebSocket(`ws://localhost:4000?taskId=${taskId}`);
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data);
};
```

### SDK

```typescript
import { AiHarnessClient } from "@ai-harness/sdk";

const client = new AiHarnessClient({
  baseUrl: "http://localhost:4000",
  apiKey: "ah_live_...",
});

const task = await client.createTask({
  goal: "Build a REST API",
  projectId: "proj_123",
});
```

### CLI

```bash
npm install -g @ai-harness/cli

aiharness build "Add user authentication"
aiharness status <task-id>
aiharness health
```

## Documentation

- [AGENT_GUIDE.md](./AGENT_GUIDE.md) — Agent system
- [TOOL_GUIDE.md](./TOOL_GUIDE.md) — Tool system
- [SDK_GUIDE.md](./SDK_GUIDE.md) — SDK usage
- [CLI_GUIDE.md](./CLI_GUIDE.md) — CLI usage
- [SECURITY.md](./SECURITY.md) — Security
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architecture

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npx vitest run`
5. Run typecheck: `npx tsc --noEmit -p tsconfig.check.json`
6. Submit a pull request

## License

Proprietary — All rights reserved.
