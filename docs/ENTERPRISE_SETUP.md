# Enterprise Setup

What running AI Harness for a team or organization actually looks like:
deployment patterns, SSO/SAML, provisioning, roles, audit, secrets, and
network controls — with an explicit line between **what is built and
verified** and **what does not exist yet**. Nothing on this page is
aspirational unless it is listed under
[What does not exist](#what-does-not-exist).

> Related: security controls and threat model in
> [SECURITY.md](../SECURITY.md); single-node and scaling detail in
> [Self-Hosting](guides/self-hosting.md); role semantics in
> [Rules and Instructions](RULES_AND_INSTRUCTIONS.md).

## Contents

- [Deployment patterns](#deployment-patterns)
- [SSO: Okta, Azure AD, Google, SAML 2.0](#sso-okta-azure-ad-google-saml-20)
- [SCIM provisioning](#scim-provisioning)
- [2FA, sessions, invitations](#2fa-sessions-invitations)
- [Roles and permissions](#roles-and-permissions)
- [Audit and governance](#audit-and-governance)
- [Secrets and encryption](#secrets-and-encryption)
- [Network controls](#network-controls)
- [Data protection and retention](#data-protection-and-retention)
- [Observability](#observability)
- [Enterprise readiness matrix](#enterprise-readiness-matrix)
- [What does not exist](#what-does-not-exist)
- [FAQ](#faq)

## Deployment patterns

| Pattern | Shape | Use when |
|---|---|---|
| **Single node** | One host, `docker compose up`, all services + volumes | Teams ≤ ~20; the [quickstart](guides/self-hosting.md#2-single-node-quickstart) |
| **Scaled compose** | Same stack, `--scale api=2` (+ worker replicas) | More HTTP throughput; proven locally at 50 rps p95 ~200 ms ([Benchmarks](BENCHMARKS.md)) |
| **GCP managed** | Artifact Registry + Cloud SQL (HA) + Redis (STANDARD_HA) + 3 Cloud Run services — **12 Terraform resources** in `infra/terraform/` | Production cloud; applied via `deploy.yml` or manually ([checklist](../EXTERNAL_DEPLOYMENT_CHECKLIST.md)) |
| **Hybrid bridge** | Control plane in cloud; code executes on customer machines via Bridge Gateway + local tools | Regulated code that must not leave the premises |
| **Frontend split** | Next.js on Vercel (`/env.js` runtime config), API on Cloud Run | The path `EXTERNAL_DEPLOYMENT_CHECKLIST.md` §6 documents |

Terraform provisions: Artifact Registry, Cloud SQL (Postgres 17,
`deletion_protection`, regional HA, private IP, automated backups), Cloud SQL
DB+user, Redis 7.4 HA, Cloud Run services for api/worker/gateway, runtime
service account with `cloudsql.client`, and `allUsers` invoker on the API.

**Not provisioned by the Terraform stack** (bring your own or extend it):
load balancer / custom domain / managed TLS, VPC firewall rules, Cloud
Secret Manager (secrets currently pass as container env vars), monitoring
alerting, multi-region. The bridge gateway is single-replica by design and
speaks plain HTTP with a shared-token auth — keep it on a trusted network
([self-hosting §6/§10](guides/self-hosting.md)).

## SSO: Okta, Azure AD, Google, SAML 2.0

Workspace-scoped SSO configs (`SsoConfig` table, unique per
workspace + provider). **Signature verification on SAML responses is
implemented** (X.509 IdP certificate verified against the
`SignedInfo` reference), and secrets are encrypted at rest.

**Endpoints** (all under a workspace, OWNER manages / MEMBER views):

```text
GET    /v1/workspaces/:wsId/sso                     list configs
POST   /v1/workspaces/:wsId/sso                     create (okta|azure_ad|google|saml)
GET    /v1/workspaces/:wsId/sso/:configId           read one
PUT    /v1/workspaces/:wsId/sso/:configId           update
DELETE /v1/workspaces/:wsId/sso/:configId           remove
GET    /v1/workspaces/:wsId/sso/:configId/test      field-presence preflight
GET    /v1/sso/:wsId/:provider/login                start OIDC flow (okta/azure_ad/google)
POST   /v1/sso/:wsId/:provider/callback             OIDC code exchange + JIT issue
GET    /v1/workspaces/:wsId/sso/saml/metadata       our SP metadata (download for the IdP)
POST   /v1/sso/:wsId/saml/callback                  SAML Response → signature verify → JIT issue
```

**First-login JIT provisioning:** a validated SSO assertion creates the user
(`passwordHash = SSO_MANAGED_MARKER` — password login impossible for that
account), adds a workspace membership with role **MEMBER**, issues a normal
access token, and writes an `SSO_LOGIN` audit event.

### Configure Okta (OIDC)

```bash
# 1. Create an OIDC app in Okta; note issuer + client id/secret
# 2. Register it on the workspace (secret is encrypted server-side)
curl -X POST http://localhost:4000/v1/workspaces/$WS/sso \
  -H "authorization: Bearer $OWNER_TOKEN" -H "content-type: application/json" \
  -d '{"provider":"okta","clientId":"0oa...","clientSecret":"...",
       "domain":"example.com","metadataUrl":"https://example.okta.com/..."}'
# 3. Optional: set OKTA_ISSUER_URL in the API environment (sso-service uses it)
# 4. Preflight
curl http://localhost:4000/v1/workspaces/$WS/sso/$CONFIG/test -H "authorization: Bearer $OWNER_TOKEN"
```

### Configure a SAML 2.0 IdP (Okta/Azure AD/ADFS-style)

1. `GET /v1/workspaces/:wsId/sso/saml/metadata` → hand our SP metadata to
   the IdP (entity ID, ACS URL, NameID).
2. From the IdP: issuer, SSO URL, and the **X.509 signing certificate**
   (PEM) — plus the signed `metadataXml` if you keep it.
3. `POST /v1/workspaces/:wsId/sso` with
   `{"provider":"saml","idpCertificate":"-----BEGIN CERTIFICATE-----…",
   "metadataXml":"…","domain":"example.com"}`.
4. Login: direct users to `GET /v1/sso/:wsId/saml/login`-equivalent flow;
   the IdP posts the `SAMLResponse` to
   `POST /v1/sso/:wsId/saml/callback`, where the signature is verified
   **before** any session is issued (requests without a configured
   certificate are refused).

**Verified by:** `backend/apps/api/tests/sso.integration.test.ts`
(CRUD + Okta login/callback + SAML base64 callback + test endpoint +
role/404 cases).

**Honest gaps (as of this writing):**

| Gap | Status |
|---|---|
| Frontend "Sign in with SSO" button | Not wired — no frontend route links to `/v1/sso/.../login`; use the API URL directly or add the link |
| "Require SSO" org setting | Stored and rendered, **not enforced** at password login |
| Email-domain gating | `domain` stored + validated for presence in test; **not compared** at login |
| IdP metadata URL import | `metadataUrl` stored, never fetched — paste certificate/XML manually |
| Group → role mapping | SCIM syncs groups, but nothing maps them to workspace roles |

## SCIM provisioning

SCIM 2.0 endpoints at **`/v1/scim/*`** (`Users`, `Groups`,
`/Users/:id` GET/PUT/DELETE) with the standard SCIM error/User/Group
schemas. User sync marks accounts `scim-managed`; group sync upserts group
membership.

**How auth works today (important):** the endpoint authenticates with a
**normal application Bearer JWT** (`app.authenticate`), and scoping comes
from `?orgId=` or the caller's first membership. There is **no dedicated
SCIM bearer token** — Okta/Outbound-Provisioning style clients that insist
on their own `Authorization: Bearer <scim-token>` profile need that
integration added first. `scimEnabled` is a stored org setting, not an
enforcement switch. The admin UI's SCIM page calls `/v1/admin/scim/*`
routes that do not exist in the backend and shows an error state — drive
`/v1/scim/*` via API until that page is reconnected.

```bash
# List provisioned users (app JWT + org scope)
curl "http://localhost:4000/v1/scim/Users?orgId=$ORG" \
  -H "authorization: Bearer $TOKEN"
```

## 2FA, sessions, invitations

| Capability | Endpoints / behavior |
|---|---|
| **TOTP 2FA** | `POST /v1/2fa/setup` → `…/confirm` → `…/verify` at login, `…/disable`, `GET …/status`. Secret encrypted AES-256-GCM with `ENCRYPTION_KEY`. UI: Settings → Security |
| **Sessions** | `GET /v1/auth/sessions` (list), `DELETE /v1/auth/sessions/:id`, `POST /v1/auth/sessions/revoke-others` — refresh tokens rotate with reuse detection |
| **Invitations** | `POST /v1/workspaces/:id/invitations` (OWNER; roles **MEMBER or VIEWER** only), list, revoke, `POST /v1/invitations/accept`. Tokens are hashed, workspace+email unique, TTL-bound |
| **OAuth social login** | GitHub + Google, opt-in via `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`; audited as `USER_OAUTH_LOGIN` |
| **Password auth** | Argon2id (19 MB, t=2), HS256 JWT + rotating refresh, forgot/reset flows (email delivery needs `RESEND_API_KEY`) |

## Roles and permissions

### Workspace roles (3 — there is no workspace ADMIN)

| Capability | VIEWER | MEMBER | OWNER |
|---|:--:|:--:|:--:|
| Read workspace, members, tasks, diffs, usage, audit logs | ✅ | ✅ | ✅ |
| Create/run tasks, sessions, branches, templates, files, env vars | — | ✅ | ✅ |
| API keys, webhooks, cost alerts, knowledge writes, deploys | — | ✅ | ✅ |
| Manage audit retention, workspace rate-limit config | — | ✅ | ✅ |
| Instructions & policy, SSO config, members, archive, delete, billing, IP allowlist, backups, model-route table | — | — | ✅ |

Enforcement is mechanical: `requireWorkspaceRole(...)` with a rank map
(`VIEWER 1 < MEMBER 2 < OWNER 3`) — **192 call sites** across the API
(MEMBER 94 · VIEWER 67 · OWNER 31). Platform-level administrators hold
`PlatformRole.PLATFORM_ADMIN` and gate the `/v1/admin/*` surface (users,
workspaces, stats, health, audit list/export).

### Organization permission catalog

Org memberships use built-in roles `OWNER / ADMIN / MEMBER / VIEWER` backed
by a **26-string permission catalog** (`settings.sso.manage`,
`audit.export`, `member.role.manage`, `workspace.delete`, …) with per-role
defaults (OWNER 22 · ADMIN 11 · MEMBER 4 · VIEWER 3) and introspection
endpoints: `GET /v1/organizations/:orgId/roles`,
`GET /v1/permissions`, `POST /v1/organizations/:orgId/permissions/check`.

**Honest gaps:** **custom roles are not functional** (raw SQL against a
`custom_roles` table that no Prisma model/migration creates). Also,
`OrganizationMember.role` is typed to the workspace enum, so the code-level
`ADMIN` value cannot currently be stored at org level. Do not promise
custom-role RBAC until those land.

> Note: `SECURITY.md` shows a 4-row workspace table including ADMIN — the
> database enum is `OWNER | MEMBER | VIEWER` (schema
> `workspace_members.role`); this page matches the schema.

## Audit and governance

**Two tables:** `audit_log_entries` (primary — adds `ipAddress` +
`userAgent`, indexed by workspace/user/action/time) and `audit_logs`
(legacy writers). Failure to write an audit row is logged, never thrown —
audit never breaks the operation it records.

**Taxonomy:** a declared union of **35 `AuditAction` types** (logins,
workspace/project/task lifecycle, deployments, providers, MCP, bridges,
2FA, admin actions, org events, builder) and **84 distinct action strings**
in total across the backend — including `PLAN_APPROVED`,
`PLAN_REJECTED`, `PLAN_REVISION_REQUESTED`, `WORKSPACE_POLICY_UPDATED`,
`INSTRUCTIONS_UPDATED`, `SSO_CONFIG_CREATED`, `SSO_LOGIN`,
`IP_ALLOWLIST_UPDATED`, `BACKUP_RESTORED`, `CHECKPOINT_ROLLED_BACK`,
`API_KEY_ROTATED`, `MEMBER_ROLE_UPDATED`.

**Query surfaces:**

```bash
# Platform admin: filtered list (limit ≤100), detail, CSV export (≤10,000 rows)
GET /v1/admin/audit-logs?userId=&workspaceId=&action=&entityType=&startDate=&endDate=
GET /v1/admin/audit-logs/:entryId
GET /v1/admin/audit-logs/export

# Any workspace member (VIEWER+): workspace-scoped, paginated
GET /v1/workspaces/:workspaceId/audit-logs
```

**Retention:** per-workspace `retentionDays` (7–365, **default 90**),
`GET/PUT /v1/workspaces/:id/audit-retention`, stats endpoint, and
`POST …/audit-retention/cleanup` which hard-deletes rows past the cutoff.
**Auto-cleanup is not scheduled** — flag exists, no worker job runs it;
call cleanup from your scheduler (or cron) until it is.

## Secrets and encryption

**Algorithm:** AES-256-GCM (12-byte IV, 16-byte tag, layout
`iv|tag|ciphertext`) over a 32-byte base64 `ENCRYPTION_KEY`.

**Encrypted at rest** (each with a call-site in code):

| Data | Where |
|---|---|
| Provider credentials + metadata | `provider_connections.encryptedCredential/encryptedMetadata` |
| MCP server config blobs | `mcp_servers.encryptedConfig` |
| SSO client secrets + metadata XML | `sso_configs` (encrypted on write, decrypted only for token exchange) |
| Deployment secrets | `deployment_secrets.encryptedValue` |
| Project env vars | `projects.env_vars` |
| 2FA TOTP secrets | user record |
| WebContainer API key, deployment-provider credentials | module settings |
| Passwords | **Argon2id** (not AES) |

**Key rotation (zero-downtime):** `ENCRYPTION_KEY` accepts a
comma-separated list — **first key encrypts; every key is tried for
decrypt**:

```bash
# 1. Generate a new 32-byte key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# 2. .env: ENCRYPTION_KEY=<new>,<old>  → restart API + worker
# 3. Verify: read a provider connection, an SSO config, a 2FA status
# 4. After confidence window, drop the old key (there is no bulk
#    re-encryption tool — old ciphertexts written with the dropped key
#    become unreadable, so keep the old key until data is re-saved)
```

**No KMS/Vault integration** — key management is the file on the host (or
Terraform variable). Treat `ENCRYPTION_KEY` loss as **permanent credential
loss**; it belongs in your backup set ([self-hosting §9](guides/self-hosting.md#9-backups)).

## Network controls

| Control | What exists |
|---|---|
| **IP allowlist** | Workspace-level `ipAllowlistEnabled` + entries, enforced by a **global** `preHandler` before routes; OWNER manages, MEMBER reads (`GET/PUT /v1/workspaces/:id/ip-allowlist`) |
| **Global rate limit** | Redis-backed `@fastify/rate-limit`, `RATE_LIMIT_GLOBAL_MAX` per minute, keyed by user→IP; **boot fails in production if Redis is down** (fail-closed) |
| **Route overrides** | signup 5/h · login 10/15min · reset 5/h · tasks 30/h · approvals 120/min · deploys 20/10/30 per hour · builder/sandbox/billing/multiplayer/metrics caps |
| **Workspace rate-limit config** | `GET/PUT /v1/workspaces/:id/rate-limits` + usage endpoints + `RateLimit` table exist — **but the enforcement helper has no call sites yet**; today only the global + route layers bite |
| **CSRF** | Double-submit cookie `ah_csrf` + `x-csrf-token`, HMAC-SHA256 with `CSRF_SECRET` (**required in production — boot throws without it**), `sameSite=strict`, registered frontend `Origin`s skip the token check |
| **CORS** | Allow-list from `FRONTEND_ORIGIN` (comma-separated), credentials on, mirrored into CSRF + Socket.IO |
| **Headers** | Helmet CSP in production (`default-src 'self'`, `connect-src 'self' ws: wss:`, `frame-ancestors 'none'`) — **no HSTS header yet**; terminate TLS at your edge |
| **Limits** | 2 MB JSON body, 10 MB multipart, 120 KB context budget is internal |

## Data protection and retention

- **Workspace lifecycle:** `POST /v1/workspaces/:id/archive` freezes task
  creation (archived workspaces reject new tasks; rename still allowed),
  audited `WORKSPACE_ARCHIVED`; `unarchive` restores.
- **In-app backups:** application-level JSON snapshots per workspace —
  create/list/restore (OWNER, `confirm: true`), **max 10**, route TTL 24 h,
  worker sweep removes backups older than 7 days. `BACKUP_CREATED/
  RESTORED/DELETED` are audited.
- **Infrastructure backups:** Cloud SQL automated backups + deletion
  protection (Terraform); host-level Postgres volume + `.env` + Terraform
  state per [self-hosting §9](guides/self-hosting.md#9-backups).
- **Audit retention:** default 90 days, 7–365 configurable, manual cleanup.
- **User lifecycle:** admin **suspend** (`POST /v1/admin/users/:id/deactivate`
  → `SUSPENDED`, bulk variant available). **There is no self-service
  erasure/export** — plan off-platform GDPR processes around the database
  until it exists.
- **What we do not claim:** no SOC 2 / HIPAA / DPA / zero-retention /
  subprocessor documentation exists in this repository. Do not represent
  those to customers on the strength of this codebase.

## Observability

- `GET /healthz` (liveness: status + db), `GET /v1/admin/health`
  (platform admin), `GET /v1/admin/metrics` (queues incl. `failed`
  counts), Prometheus `GET /v1/metrics` (`queue_jobs` gauges included;
  rate-limited 30/min).
- Structured pino logs with request-id chain; queue-depth lines; OpenAPI
  at `/docs`.
- **Sentry** (`@sentry/node`) initializes in API + worker when
  `SENTRY_DSN` is set — inert when empty. **PostHog** in the frontend
  behind `NEXT_PUBLIC_POSTHOG_KEY` — inert when empty.
- Full detail: [self-hosting §8](guides/self-hosting.md#8-observability).

## Rollout playbook

**Phase 1 — Pilot (one workspace, week 1):**
- Single-node or scaled compose; generate the four secrets; TLS at the edge.
- Connect one provider; leave `requirePlanApproval: true`.
- Run 10 real tasks (use the [Use Cases](USE_CASES.md) catalog); check the
  audit trail after: `GET /v1/workspaces/:ws/audit-logs`.
- Enable 2FA for yourself (Settings → Security). Take a backup:
  `POST /v1/workspaces/:ws/backups`.

**Phase 2 — Team (week 2–3):**
- Paste workspace **instructions** (conventions + definition of done) and
  tighten **policy** (`maxSubagents: 0`, WRITE→ASK stays default).
- Invite members (MEMBER/VIEWER); create two task templates.
- Set audit retention (start 90 days, verify cleanup endpoint runs from
  your scheduler).
- Configure SSO against a test IdP app; run `GET .../sso/:id/test`; have
  one user JIT-login; confirm `SSO_LOGIN` in the audit log.

**Phase 3 — Org (week 4+):**
- Enforce password policy by exception (Require-SSO enforcement is not
  built yet — [gaps](#what-does-not-exist)).
- IP allowlist for the office/VPN CIDRs; workspace rate-limit config
  recorded (enforcement still global/route-level).
- Move to GCP Terraform or your orchestrator; wire
  `EXTERNAL_DEPLOYMENT_CHECKLIST.md` secrets; Sentry DSN; backup automation
  + restore drill ([self-hosting §9](guides/self-hosting.md#9-backups)).
- Rehearse: key rotation ([secrets](#secrets-and-encryption)), workspace
  archive, audit export.

**Verification checklist (end of each phase):**

```bash
curl -s localhost:4000/healthz | grep '"status":"ok"'
# audit shows your pilot actions; CSV export works (platform admin)
# backup exists AND a restore was tested once
# one SSO login and one password login both audited
```

## Sizing

Measured on the benchmark host (4-core i5, 11.7 GB RAM, compose, API ×2):

| Dimension | Observed / guidance |
|---|---|
| HTTP tier | 50 rps sustained at p95 ~200 ms (27% of the 750 ms budget); ceiling 50–75 rps for auth-heavy traffic ([Benchmarks](BENCHMARKS.md)) |
| Bottleneck | argon2id password hashing on signup/login — not the event loop |
| API replicas | Scale horizontally (`--scale api=N`); distribution is even |
| Worker | `WORKER_CONCURRENCY` × agent RAM; plan runs are the memory hog (context engine ≤ 120 KB/call) |
| Cloud Run baseline | api 1 CPU/512 MiB, worker, gateway 256 MiB — raise worker memory before adding replicas |
| Database | Cloud SQL HA + private IP; the API is stateless — SQL is the shared resource |
| Users/team | Pilot ≤ 20 on single node; 30 tasks/hour/user creation limit bounds bursts |

Rules of thumb: add **API** replicas for more concurrent users; add
**worker** concurrency for more parallel agent runs; upgrade **SQL** when
verification queries dominate. Re-measure with
[the k6 profile](BENCHMARKS.md#reproducing-these-numbers) after any change.

## Enterprise readiness matrix

| Capability | Status | Where |
|---|---|---|
| Password auth + rotating refresh, reuse detection | ✅ Built | `modules/auth` |
| SSO — Okta / Azure AD / Google (OIDC) | ✅ Built + tested | `sso.routes.ts`, `tests/sso.integration.test.ts` |
| SAML 2.0 with signature verification | ✅ Built + tested | `saml-parser.ts` |
| JIT user provisioning from SSO | ✅ Built | SSO callback → `SSO_MANAGED_MARKER` |
| SCIM 2.0 Users/Groups API | ✅ Built (app-JWT auth) | `/v1/scim/*` |
| 2FA (TOTP) | ✅ Built | `two-factor.routes.ts` |
| Workspace RBAC (3 roles, 192 gates) | ✅ Built | `plugins/auth.ts` |
| Org permission catalog + checks | ✅ Built | `organizations.roles.ts` |
| Audit log + CSV export + retention | ✅ Built (manual cleanup) | `admin/audit-log.routes.ts` |
| AES-256-GCM at rest + key-list rotation | ✅ Built | `shared/crypto.ts` |
| IP allowlist | ✅ Built | global preHandler |
| Rate limiting (global + route) | ✅ Built | `plugins/rate-limit.ts` |
| CSRF (HMAC double-submit) | ✅ Built | `plugins/csrf.ts` |
| Invitations (hashed, TTL) | ✅ Built + E2E | `invitations.routes.ts` |
| Sessions list/revoke | ✅ Built | `users.routes.ts` |
| Workspace backups + Cloud SQL backups | ✅ Built | backup routes, Terraform |
| GCP Terraform (12 resources, HA SQL/Redis) | ✅ Built | `infra/terraform/` |
| Sentry/PostHog wiring | ✅ Built (accounts external) | `server.ts`, `analytics.ts` |
| "Require SSO" enforcement | ⚠️ Setting only | not read at login |
| Domain-gated SSO | ⚠️ Stored only | not compared |
| SCIM bearer token + admin API | ⚠️ Partial | `/v1/scim/*` works; `/v1/admin/scim/*` absent |
| Custom roles | ⚠️ Not functional | no `custom_roles` table |
| Workspace rate-limit enforcement | ⚠️ Config API only | helper uncalled |
| Scheduled audit auto-purge | ⚠️ Flag only | no worker job |
| HSTS, gateway TLS, Secret Manager in TF | ❌ Not built | edge/KMS is yours |
| LDAP | ❌ Absent | — |
| SSO login button in frontend | ⚠️ Not wired | API URL works |
| SOC 2 / HIPAA / DPA / zero-retention | ❌ No support in repo | do not claim |

## What does not exist

Stated explicitly so nobody discovers it in an audit:

1. **No LDAP.** No platform-wide IdP — SSO is workspace-scoped config only.
2. **No KMS/Vault; no secret re-encryption tool** — app-level key file +
   comma-list rotation only.
3. **No Cloud Secret Manager in Terraform** — sensitive vars pass as plain
   container env; move them yourself if required.
4. **No HSTS header; bridge gateway is plain HTTP + shared token** — put
   TLS in front (edge LB or stunnel) and keep the gateway private.
5. **No SCIM bearer token**; **no SCIM admin API**; `scimEnabled` not
   enforced.
6. **No "Require SSO" or domain enforcement** at login; **no frontend SSO
   button**.
7. **No custom roles** (missing table/migration); org `ADMIN` value not
   storable today.
8. **No scheduled audit purge** — call `POST …/audit-retention/cleanup`
   from cron.
9. **No workspace rate-limit enforcement** — the config API is written but
   the helper is uncalled.
10. **No user erasure/export** — suspend only; `UserStatus.DELETED` is
    never set.
11. **No compliance artifacts** — no SOC 2, HIPAA, GDPR DPA, subprocessor
    list, or zero-retention claims are supported by this repository.
12. **No LB/custom-domain/managed-cert/VPC/multi-region** resources in
    Terraform; gateway is single-replica by design.

## FAQ

**Can we force employees through Okta only?**
Not yet — configs and JIT work, but password login is not suppressed.
Until "Require SSO" is enforced server-side, mitigate with policy: disable
invites, require 2FA, and treat password accounts as exception accounts.

**How do we rotate `ENCRYPTION_KEY` without downtime?**
Compose list `new,old` → restart → verify reads → later drop old. Keep the
old key until all ciphertexts are rewritten (no bulk re-encryptor exists).

**Where do audit logs go? Where are they capped?**
`audit_log_entries` in your Postgres. Workspace scope readable by VIEWER+;
CSV export is **platform-admin only**, capped at 10,000 rows per call;
retention 7–365 days (default 90), manual cleanup.

**Can code run inside our network while the control plane runs in cloud?**
Yes — that is the Bridge pattern: cloud API/worker/gateway pair with a
bridge agent on your machine; tools execute locally under policy.

**Is anything sent to us if we bring our own model keys?**
Provider credentials are AES-256-GCM encrypted and used for outbound model
calls only; token usage is metered for quotas. See
[Models & Pricing](MODELS_AND_PRICING.md).

**What is the minimum production environment?**
Compose stack + generated secrets (`JWT_ACCESS_SECRET`, `CSRF_SECRET`,
`ENCRYPTION_KEY`, `BRIDGE_INTERNAL_TOKEN`), Redis with `appendonly`,
Postgres with backups, TLS at the edge — [self-hosting §2–§4](guides/self-hosting.md).

## Related reading

- [SECURITY.md](../SECURITY.md) — threat model and control details
- [Self-Hosting](guides/self-hosting.md) — topology, env vars, scaling, backups
- [External deployment checklist](../EXTERNAL_DEPLOYMENT_CHECKLIST.md) — GCP + GitHub Actions path
- [Rules and Instructions](RULES_AND_INSTRUCTIONS.md) — policy tier and role semantics
- [Permissions & Approvals](guides/permissions-and-approvals.md) — run-time enforcement
- [API Reference](API.md) — SSO + audit endpoints
- [Benchmarks](BENCHMARKS.md) — capacity numbers for sizing

---

Related: [Models & Pricing](MODELS_AND_PRICING.md) ·
[Use Cases](USE_CASES.md) · [Documentation benchmark](DOCUMENTATION_BENCHMARK.md)
