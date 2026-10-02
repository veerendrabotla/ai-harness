# AI Harness — Security Documentation

## Threat Model

**Assets**

- Tenant data (workspaces, projects, tasks, memories, audit logs)
- Provider credentials (model API keys) — the highest-value secret
- The agent execution plane (arbitrary code runs on user intent)
- The control plane (session state, platform-admin actions, billing)

**Actors:** authenticated users scoped by workspace RBAC; the anonymous
Internet (rate limits + auth on every protected route); a malicious or
compromised model provider (model output is *untrusted input*); and a
compromised dependency (see Supply Chain below).

**Trust boundaries**

1. Browser / CLI / SDK → API — JWT validation, rate limits, request-schema validation
2. API → worker → sandbox — deny-first permission engine + approval coordinator
3. Sandbox → network/tools — path confinement, SSRF guard, per-workspace tool policies
4. Local bridge → preview targets — loopback-only binding + HMAC tickets
5. API → model providers — credentials decrypted only at execution time

**Non-goals:** defending against a hostile host operator (self-hosted
deployments trust their own infrastructure) and hardware side channels (the
sandbox uses containers with dropped capabilities and resource caps, not a
microVM).

## Authentication

### JWT Tokens
- Access tokens: 15-minute TTL (configurable)
- Refresh tokens: 30-day TTL
- Token rotation on every refresh
- Tokens stored in httpOnly cookies

### Password Security
- Argon2id hashing (not bcrypt)
- Minimum 8 characters
- Password reset via email with 30-minute TTL

### 2FA Support
- TOTP-based (Google Authenticator, Authy)
- Recovery codes for backup
- Optional per workspace

### SSO/SAML
- Okta, Azure AD, Google Workspace
- SAML 2.0 with XML signature verification
- Domain-based auto-provisioning

## Authorization

### RBAC Roles
| Role | Permissions |
|------|-------------|
| OWNER | Full workspace control, billing, delete |
| ADMIN | Manage members, settings, projects |
| MEMBER | Create/edit projects, tasks, deploy |
| VIEWER | Read-only access |

### Platform Role
- `USER` — Standard user
- `PLATFORM_ADMIN` — System-wide admin access

## Encryption

### At Rest
- AES-256-GCM for secrets (API keys, tokens, passwords)
- Base64-encoded 32-byte key
- Unique IV per encryption operation
- Never store plaintext secrets

### In Transit
- TLS 1.3 for all API communication
- WebSocket connections use WSS
- Internal service communication via encrypted channels

## Permission Engine

Centralized deny-first policy evaluation:

```typescript
const engine = new CentralizedPermissionEngine();

const decision = engine.evaluate({
  resource: "git",
  action: "push",
  riskLevel: "HIGH",
  userRole: "MEMBER",
});

// Decision: { allowed: false, requiresApproval: true, reason: "..." }
```

### Risk Levels
| Level | Examples | Approval |
|-------|----------|----------|
| LOW | Read file, git status | Auto |
| MEDIUM | Write file, git commit | Auto |
| HIGH | Delete file, git push, deploy | Required |
| CRITICAL | Force push, drop database | Always required |

## Rate Limiting

Per-user, per-endpoint rate limits:

```yaml
Global: 100 requests/minute
Auth: 10 requests/15 minutes
Tasks: 30 requests/minute
Deploy: 10 requests/5 minutes
```

Rate limits are enforced via Redis with periodic database persistence.

## Audit Logging

Every sensitive operation is logged:

```typescript
{
  action: "TASK_CREATED",
  entityType: "Task",
  entityId: "task_123",
  actorUserId: "user_456",
  workspaceId: "ws_789",
  metadata: { goal: "..." },
  ipAddress: "192.168.1.1",
  userAgent: "...",
  timestamp: "2025-01-15T10:30:00Z"
}
```

### Logged Operations
- Authentication (login, register, logout)
- Task creation, approval, cancellation
- Tool execution
- Deployment
- Secret access
- Permission changes
- Admin operations

## Tenant Isolation

Every database query is scoped to the workspace:

```typescript
// This query is automatically scoped
const tasks = await prisma.task.findMany({
  where: { workspaceId }
});
```

### Isolation Boundaries
- Workspace data
- Project data
- Session data
- Memory stores
- Sandbox environments
- Deployment credentials
- Execution traces
- Audit logs

## Agent Sandbox Isolation

Agent-generated code runs in Docker containers, never inside the API or
worker process. `backend/packages/sandbox-engine` enforces, with every claim
covered by the 22-test `docker-isolation.test.ts` suite:

- **Capabilities dropped + read-only rootfs** — no privilege escalation, no
  in-place binary patching; writes confined to the workdir
- **Namespace isolation** — separate PID/mount namespaces; host processes are
  invisible from inside the sandbox
- **Environment hygiene** — host secrets are stripped from the container
  environment; provider keys are never injected into sandboxes
- **Process limits** — PID caps plus idle/lifetime timeouts; hung commands
  are killed and reported as timed out, never left running
- **Filesystem limits** — disk quota enforcement; exhaustion fails the run
  instead of filling the host
- **Path traversal prevention** — reads/writes outside the workspace are
  rejected (the same policy as `confinePath` in the API layer)
- **Cleanup** — containers and their filesystems are destroyed after runs and
  after crashes; zombie containers are reaped

`SANDBOX_MODE` selects the isolation backend; `docker` is the production
default.

## Path Confinement

Prevents directory traversal attacks:

```typescript
import { confinePath } from "@ai-harness/shared";

// Valid path
confinePath("/workspace/src/index.ts", "/workspace");
// Returns: /workspace/src/index.ts

// Attempted traversal
confinePath("/workspace/../../etc/passwd", "/workspace");
// Throws: Error - path escapes workspace
```

## SSRF Protection

Blocks requests to private/internal addresses:

```typescript
import { isSafeOutboundUrl } from "@ai-harness/shared";

isSafeOutboundUrl("https://api.example.com");
// Returns: true

isSafeOutboundUrl("http://169.254.169.254");
// Returns: false (cloud metadata)

isSafeOutboundUrl("http://localhost:5432");
// Returns: false (internal service)
```

## Prompt Injection Defense

Randomized delimiters for untrusted content:

```typescript
import { fenceUntrusted } from "@ai-harness/shared";

const safe = fenceUntrusted(userInput);
// Wraps input with random delimiter that agents cannot predict
```

## Secret Management

### Storage
- API keys encrypted with AES-256-GCM
- Stored in `provider_connections` table
- Never logged or exposed in API responses

### Access
- Decrypted only at execution time
- Passed directly to adapter/tool
- Never stored in plaintext in memory

### Rotation
- Support for key rotation without downtime
- Old keys can be used for pending operations
- New keys take effect for new operations

## WebSocket Security

### Authentication
- Device tokens for bridge connections
- JWT tokens for browser connections
- Token validation on connection

### Authorization
- Workspace-scoped subscriptions
- No cross-tenant message delivery

### Rate Limiting
- Connection limits per user
- Message rate limits

## Deployment Security

### Credential Storage
- Provider credentials encrypted at rest with AES-256-GCM
- Single `ENCRYPTION_KEY` per deployment; rotation supported via a comma-separated key list (newest key encrypts, older keys still decrypt)
- Never exposed in API responses

### Build Security
- Sandboxed build environments
- No access to other tenants' data
- Timeouts and resource limits

### Preview Security
- Isolated preview environments
- No access to production data
- Automatic cleanup

## Supply Chain & Build Integrity

- **Blocking dependency audit in CI** — every push runs
  `npm audit --omit=dev --audit-level=high`; any high/critical production
  advisory fails the pipeline. Moderate advisories are tracked to their fix
  (today's known residue: a `google-auth-library` major-chain — `gaxios` and
  `uuid` moderates that only clear on the next major bump)
- **Lockfile installs only** — CI and images install from
  `package-lock.json` (`npm ci`), never from floating ranges; root
  `overrides` pin a patched `postcss` under `next`
- **Reproducible production bundles** — images build the esbuild backend
  bundles in-image from the same lockfile; `tsx` is dev-only and never ships
- **Version-pinned base images** (`postgres:17.4`, `redis:7.4`, `node:22`),
  rebuilt and boot-tested by the CI `docker` job on every push
- **No secrets at build time** — images carry no keys; runtime injects
  environment (compose `env_file`, CI services) and `setup-env.mjs`
  generates fresh per-deployment secrets

## Governance & Enterprise Controls

Deeper material — SSO/SCIM integration, org-wide policy, audit-retention
configuration, data export/backup, and deployment checklists — lives in
[ENTERPRISE_SETUP.md](docs/ENTERPRISE_SETUP.md); SECURITY.md stays focused on
the technical control surface. Highlights:

- **Audit retention** is configurable per organization
  (`audit_retention_settings`); audit logs are exportable
- **Data portability** — workspace backups (`workspace_backups`) and
  session/task exports (`session_exports`, `session_shares`) with expiry
- **Enterprise SSO** — SAML with signature verification and domain-based
  auto-provisioning (see Authentication → SSO/SAML)
- AI Harness holds **no formal certification** (SOC 2 / ISO 27001);
  ENTERPRISE_SETUP maps controls to common enterprise review questionnaires

## Vulnerability Reporting

Report security vulnerabilities to: security@aiharness.dev

### Response Timeline
- Acknowledgment: 24 hours
- Initial assessment: 72 hours
- Fix timeline: Based on severity

### Scope
- Authentication bypass
- Authorization bypass
- Data exposure
- Injection vulnerabilities
- Sandbox escape
- Secret exposure
