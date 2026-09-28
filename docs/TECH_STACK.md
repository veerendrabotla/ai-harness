# AI Harness — Exact Technology Stack

This document intentionally selects one implementation choice per category. Versions are pinned for implementation consistency.

# 1. FRONTEND

## Application framework
- **Next.js 15.2.4**
- **React 19.1.0**
- **TypeScript 5.8.3**

## PWA
- **Serwist 9.0.11**

## Styling
- **Tailwind CSS 4.1.11**

## UI primitives
- **Radix UI 1.3.2**

## Icons
- **Lucide React 0.468.0**

## Client state management
- **Zustand 5.0.3**

## Server state and caching
- **TanStack Query 5.66.8**

## Routing
- **Next.js App Router 15.2.4**

## Forms
- **React Hook Form 7.54.2**

## Schema validation
- **Zod 3.24.2**

## Realtime client
- **Socket.IO Client 4.8.1**

## Code editor and diff viewer
- **Monaco Editor 0.52.2**
- **@monaco-editor/react 4.7.0**

## Testing
- **Vitest 3.1.1**
- **Playwright 1.51.1**

---

# 2. BACKEND

## Runtime language
- **TypeScript 5.8.3**

## Runtime
- **Node.js 22.14.0 LTS**

## API framework
- **Fastify 5.2.1**

## API style
- **REST JSON API**
- **Socket.IO 4.8.1 for realtime events**

## Request validation
- **Zod 3.24.2**

## API documentation
- **OpenAPI 3.1 generated through @fastify/swagger 9.4.0**

## Background job queue
- **BullMQ 5.40.2**

## Job store
- **Redis 7.4**

## Logging
- **Pino 9.6.0**

---

# 3. AGENT RUNTIME

## Agent orchestration
- Custom TypeScript state-machine runtime.
- **XState 5.19.2** for explicit state transition definitions.

## Model abstraction
- Custom provider adapter interface.

## Provider adapters in V1
- Anthropic adapter using **@anthropic-ai/sdk 0.39.0**
- OpenAI adapter using **openai 4.86.1**
- Google adapter using **@google/genai 1.0.1**
- Ollama adapter using **ollama 0.5.14**
- OpenAI-compatible HTTP adapter using native `fetch`

## Token/context accounting
- Provider-reported usage when available.
- Internal character and byte budgets for context package assembly.

## Tool schemas
- Zod 3.24.2.

---

# 4. LOCAL BRIDGE

## Language
- **Go 1.24.1**

## Local API transport
- **gRPC 1.70.0**

## Backend-to-bridge control channel
- **WebSocket over TLS using nhooyr.io/websocket 1.8.17**

## Local configuration
- TOML using **BurntSushi/toml 1.4.0**

## Git integration
- Native `git` CLI invoked through controlled process execution.

## Terminal execution
- Native OS process execution with:
  - working-directory allowlist;
  - command timeout;
  - output byte limit;
  - process-tree termination attempt.

## Local model integration
- Ollama HTTP API through the registered local endpoint.

---

# 5. DATABASE

## Primary database
- **PostgreSQL 17.4**

## ORM
- **Prisma ORM 6.6.0**

## Cache and queue backend
- **Redis 7.4**

## Database migration
- Prisma Migrate 6.6.0.

---

# 6. AUTHENTICATION

## Password hashing
- **Argon2id through argon2 0.41.1**

## Access token
- JWT using **jose 6.0.10**
- Access token lifetime: **15 minutes**

## Refresh session
- Opaque random refresh token stored hashed in PostgreSQL.
- Refresh session lifetime: **30 days**
- Refresh rotation on every successful refresh.

## Password reset
- Single-use random token stored hashed.
- Expiration: **30 minutes**

---

# 7. SECURITY AND SECRET STORAGE

## Provider credential encryption
- AES-256-GCM.
- Encryption key supplied through deployment secret manager.
- Per-record random nonce.

## Secret redaction
- Custom server-side redaction pipeline.
- Pino redaction configuration for logs.

## Rate limiting
- **@fastify/rate-limit 10.2.1**
- Redis-backed.

---

# 8. DEPLOYMENT

## PWA hosting
- **Vercel**

## Backend and worker hosting
- **Google Cloud Run**

## Database
- **Google Cloud SQL for PostgreSQL 17**

## Redis
- **Google Cloud Memorystore for Redis 7.4**

## Object storage
- **Google Cloud Storage**

## Container registry
- **Google Artifact Registry**

## Infrastructure
- **Terraform 1.11.4**

---

# 9. CI/CD

## Source control
- GitHub.

## CI/CD platform
- **GitHub Actions**

## Required pipeline stages
1. Install.
2. Type check.
3. Lint.
4. Unit tests.
5. Integration tests.
6. Build.
7. Container image build.
8. Dependency vulnerability scan.
9. Deploy staging.
10. Run smoke tests.
11. Manual production approval.
12. Deploy production.

---

# 10. THIRD-PARTY SERVICES

## Payments
- **None in V1.**

## Notifications
- **Resend 4.2.0** for transactional email.

## Push notifications
- Web Push API through the PWA.
- No third-party push provider in V1.

## Storage
- Google Cloud Storage.

## Error monitoring
- **Sentry 9.12.0**

## Product analytics
- **PostHog Cloud**, JavaScript SDK **posthog-js 1.229.2**

---

# 11. VERSION CONTROL RULE

Every production dependency must be pinned to the version listed in the repository lockfile. Dependency upgrades require:
1. pull request;
2. changelog review;
3. CI success;
4. security review for major runtime/security changes.
