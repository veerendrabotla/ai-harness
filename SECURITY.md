# AI Harness — Security Documentation

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
