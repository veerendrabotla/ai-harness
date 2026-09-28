# AI Harness — Phased Roadmap & Execution Log

> **Process rule:** this file is APPEND-ONLY and ITERATIVE. Completed phases are never deleted — they stay documented below as the execution record. New work is always appended as the next phase section with status `PLANNED → IN PROGRESS → DONE` plus verification evidence.

Legend: ✅ DONE · 🔵 PARTIAL · ⬜ NOT STARTED

---

## PHASE 1 — Project foundation & vertical slice — ✅ DONE

Scope delivered:
- Monorepo scaffold (frontend / apps/api / apps/worker / 9 backend packages), strict TS, ESLint (`no-explicit-any`), Vitest, docker-compose (PG17 + Redis 7), env validation, Prettier.
- Full DB schema per BACKEND_STRUCTURE §2 (+ D1/D2 additions), initial migration applied.
- Auth: Argon2id, JWT(15m) + rotating refresh sessions w/ reuse detection, password reset tokens, rate limits (§7).
- Workspaces/projects/instructions/policy/providers/model-routes APIs with roles, audits, standard envelopes/error codes.
- Agent runtime v1: state machine (XState-derived edges), context engine, planner, permission engine, tool harness registry, approval coordinator, checkpoint manager stubs, event publisher, worker via BullMQ.
- Frontend: design system, app shell, auth pages, dashboard, workspaces/tasks UI incl. task detail (activity default tab), providers/routing pages, PWA shell (Serwist).

Verification evidence:
- typecheck/lint clean · 56 unit tests green · smoke script 13/13 · first live agent E2E COMPLETED vs Ollama qwen2.5:3b.

---

## PHASE 2 — Execution environments — ✅ DONE

Scope delivered:
- Bridge Gateway (`backend/apps/bridge-gateway`): device-token WS auth, heartbeats, presence sweep (CONNECTED→DEGRADED→DISCONNECTED + projects auto-UNAVAILABLE), internal `/execute` API.
- Reference TypeScript Local Bridge agent (`local_bridge/`): pair/add-root/run CLI; path confinement shared util; fs/git tools; allow-listed readonly terminal; confined terminal; git checkpoints + rollback.
- Worker `ExecutionEnvironmentResolver` (LOCAL_BRIDGE via gateway; INTERNAL http.request w/ SSRF guard + MCP HTTP/SSE proxy).
- Real pre-execution checkpoints for bridge projects; confirmed rollback endpoint (audited + events).
- Tool-calling implementation loop (native provider tool proposals → same permission gate); zod→JSON-Schema converter.
- Reviewer stage (VERIFYING→REVIEWING→COMPLETED, advisory).
- Google + native Ollama adapters; streaming on Anthropic/OpenAI/compatible.
- Project inspect API powering workspace Changes/Git views; session management endpoints; Resend email integration; Dockerfiles ×4; GitHub Actions CI core stages.

Verification evidence:
- Bridge E2E ALL PASSED (pairing → CONNECTED → confined inspect → traversal rejected → checkpoint → diff → rollback restored content).
- Agent E2E COMPLETED with reviewer payload.
- 67 unit tests green.

---

## PHASE 2.5 — Capability completion — ✅ DONE

Scope delivered:
- Reviewer gating policy `blockOnReviewFindings` (schema + snapshot + orchestrator gate `RUN_BLOCKED_BY_REVIEW` + settings toggle UI).
- Invitations flow end-to-end: `workspace_invites` table, owner issue/list/revoke APIs + UI card, single-use `/v1/invites/accept`, role applied on accept. E2E verified (accept → role VIEWER → single-use enforced → workspace visible).
- Streaming planning (`MODEL_TEXT_DELTA` throttled deltas).
- Docker sandbox resolver behind `SANDBOX_MODE=docker` (network-none, cpu/mem capped).
- MCP STDIO transport via connected bridge (one-shot JSON-RPC); HTTP/SSE unchanged.
- Monaco DiffEditor swap-in (lazy) behind light renderer; PostHog/Sentry env-guarded init; policy field serialized through API/UI.

Verification evidence:
- typecheck/lint clean · 67 tests green · frontend prod build green · invites E2E pass · agent E2E COMPLETED (full 22-event timeline incl. RUN_COMPLETED) · bridge E2E still passing.

---

## PHASE 3 — Test automation & delivery hardening — ✅ DONE

Items & completion log:
1. ✅ Playwright browser suite: `frontend/playwright.config.ts` + `frontend/e2e/shell.spec.ts`; runs against production build via `next start`. **4/4 specs passing** (~8.5s).
2. ✅ `browser-e2e` job wired into GitHub Actions: postgres+redis services, migrate deploy, frontend build, chromium install, api+worker started, Playwright run.
3. ✅ Terraform GCP stack written (`infra/terraform/`): Artifact Registry, Cloud SQL PG17 (regional HA, private IP, backups), Memorystore Redis 7.4 HA, Cloud Run services for api/worker/gateway with runtime SA + Cloud SQL client role, outputs for URLs. *(Apply requires GCP credentials — documented, not executed locally.)*
4. ✅ Queue observability: worker sweeper logs `metric=queue_depth {waiting, active, completed, failed}` every cycle.
5. ✅ README platform support matrix added.

---

## PHASE 4 — Future candidates — 🔵 IN PROGRESS (code-only items)

### Phase 4 execution log
- ✅ Prompt-injection defenses: randomized-fence untrusted wrapping in context engine + sanitizer (prompt-defense.test.ts 4 cases)
- ✅ Cross-process cancellation: Redis control bus → per-run AbortController → harness returns CANCELLED mid-tool (new test)
- ✅ Stuck-run recovery sweeper: orphaned active runs older than 15 min → INTERRUPTED + event
- ✅ Streaming extended to replanning stage; planner unit tests (retry/delta/safety-instruction assertions)
- ✅ Production bundles: esbuild build (
pm run build:backend) — verified 
ode dist/api/index.js serves healthz; Dockerfiles now run bundles, not tsx
- ✅ Worker Sentry init parity
- ✅ Scenario benchmark runner scripts/bench-scenarios.ts (repo-understanding / multi-file / debugging / testing scenarios w/ approval-gate exercise)
- ✅ FINAL_GAP_AUDIT.md + EXTERNAL_DEPLOYMENT_CHECKLIST.md created
- ✅ Browsable API docs: @fastify/swagger-ui mounted at /docs alongside the OpenAPI JSON at /documentation/json
- ✅ Two-worker resilience proof scripts/e2e-two-workers.ts: burst of tasks across 2 workers → every task terminal with EXACTLY ONE run (FR-012 verified under concurrency)
- ✅ MCP STDIO discovery via bridge: new mcp.stdio protocol kind + agent handler; enable flow discovers tools through the owner's connected bridge — **covered in bridge E2E with a fake STDIO server**
- ✅ Event replay benchmark scripts/bench-replay.ts (page-by-page afterSequence replay; sample run p95 ~184ms/page)
- ✅ .github/workflows/deploy.yml: OIDC build+push to Artifact Registry & terraform apply behind production manual-approval environment
- ✅ MCP server health checks: worker sweeper pings ACTIVE HTTP/SSE servers, flips to ERROR on failure
- ✅ Authenticated Playwright specs: real UI signup → /onboarding redirect; structured bad-credentials error. Suite now 6/6 passing (~11s)
- ✅ Queue metrics fixed & live: worker emits metric=queue_depth {waiting, active, completed, failed} each sweep via a dedicated Queue handle
- Cloud-hosted sandbox infrastructure (GCS-backed project copies, container-per-run Cloud Run jobs).
- ✅ MCP STDIO discovery caching (done PHASE 11 — Redis config-hash cache in `lib/mcp-discovery.ts`) + health checks (worker sweeper).
- ✅ Multi-replica Socket.IO proof (done PHASE 11 — `scripts/e2e-two-replica-socket.ts`, `npm run e2e:replicas`); event replay benchmarks (bench-replay.ts).
- Sentry dashboards/alert rules; PostHog funnels for approval flows.
- Apply Terraform to a real GCP project + wire CI deploy stages (staging → manual approval → prod).

---

## PHASE 5 — Documentation system (benchmark-driven) — ✅ DONE

Scope delivered:
- Benchmark of 16 competitors' docs (Cursor, Claude Code, Cline, Copilot, Codex, Aider, Replit, Lovable, v0, Devin, Windsurf, OpenHands, Tabnine, Augment Code) captured in `docs/DOCUMENTATION_BENCHMARK.md` — hosting, page counts, IA patterns, llms.txt adoption, and the gaps every tool leaves open.
- New documentation: `docs/README.md` (hub with reading paths), `docs/getting-started.md` (30-min first task), `docs/concepts.md` (runtime mental model), `docs/guides/{permissions-and-approvals, context-and-memory, models-and-providers, hooks-and-events, mcp, self-hosting}.md`, `docs/troubleshooting.md` (symptom→cause→fix), `docs/examples/README.md` (8 recipes), `CHANGELOG.md`, root `llms.txt` (LLM ingestion index).
- Doc-accuracy fixes found during writing: API.md plan/approval routes corrected to registered paths, WS envelope fields corrected to `eventType`/`payload`, SECURITY.md encryption-key claim corrected, CONTRIBUTING.md bridge language corrected.
- Bugs found & fixed by doc grounding: frontend WS replay called nonexistent `/activity` path + wrong response shape (`use-task-socket.ts` — now `/events` + unwrapped array); `GET /v1/health` used by SDK `health()` and 5 integration tests but never registered (now an alias of `/healthz` in `app.ts`); org-settings tab never loaded or saved real settings (now reads/writes `GET/PATCH /v1/organizations/:id/settings`, maps `requireSso↔ssoEnforced`); MCP settings page had an unclosed `<div>` (broke `next build`) and a wrong `formError` type; desktop `nativeImage` used as a type (now `NativeImage`); `@ai-harness/cli` and `@ai-harness/sdk` had no `tsconfig.json` so their `build` scripts failed; `electron-builder.yml` had an invalid `autoUpdater` block and empty `publish` config; desktop `electron` dep pinned to fixed `33.4.11` (electron-builder rejects ranges); electron-builder `npmRebuild:false` to stop its prod-deps step pruning hoisted devDependencies mid-build.
- Frontend lint gate cleared: 81 errors → 0 (unused imports/vars, conditional hook hoisted in rate-limits page); 2 warnings intentionally left.

Verification evidence:
- 177+ internal doc links checked — 0 broken · `npm run typecheck` clean · frontend `tsc` clean · `npm run lint:frontend` 0 errors (2 warnings) · `next build` green (54 pages) · cli + sdk `tsc` builds green · desktop `build:win` EXIT=0 (NSIS + portable artifacts in `release2/`) · tests 456 passed / 54 skipped / 1 failed (pre-existing ECONNREFUSED :9999; acceptance suite needs a live API on :4000; Docker isolation tests skip when Docker is off).
- Known environment quirk: a full `npm run build` re-run of the desktop step can fail while the OpenCode desktop watcher holds the previous `app.asar` lock — rebuild works after that handle clears (verified working once, EXIT=0).

---

## PHASE 6 - Post-doc gap fixes: pricing, context tiers, notifications, Docker engine - ✅ DONE

Scope delivered:
- **Pricing unification**: new `contracts/src/pricing.ts` (`MODEL_PRICING_PER_1K` canonical table + `resolveModelPricing`/`canonicalInputPrices`/`canonicalOutputPrices`); consumers refactored (`usage-tracking`, playground, models.providers.routes). `cost-tracker` now derives its defaults from the canonical table (claude-3-5-haiku at cost-tracker's own .0008/.004; deepseek-coder completion unified to 0.00056) and gained the `@ai-harness/contracts` workspace dep.
- **Context priority tiers — all 15 ranks now constructed**: `AssembleInput` extended with `stepFiles` / `dependencyConfig` / `mcpResources` (`context-engine/engine.ts`); orchestrator accepts optional `mcpRegistry`, hoists package.json dependency config + `mcpRegistry.listServersByWorkspace()` resources into `buildAndPersistContext`; `planner.ts` passes `previousPlan.affectedFiles` on revision; `runtime.ts` wires the registry. Docs table in `docs/guides/context-and-memory.md` updated (rows 7/8/14, "All 15 ranks constructed", stable-sort note).
- **Notification pipeline fully wired**: `apps/api/src/lib/notification-dispatcher.ts` (RUN_COMPLETED/RUN_FAILED/approval/deployment events → email+in-app via `notification-dispatch.ts`, Redis `SETNX` dedupe key `notify:dedupe:{key}` 1h across replicas); `plugins/socket.ts` decorates `app.notifications` + `app.publishDeploymentStatus` and dispatches on task/approval events; NEW `DEPLOYMENT_STATUS_CHANNEL` fan-out (`shared/queues.ts`) so worker→API deployment status works cross-replica (engine callback in `deploy.routes.ts` now publishes instead of local emit); `server.ts` starts/stops the email worker; invitation emails sent on `createInvitation` (`inviteAcceptUrl` → settings accept route, raw token; frontend accept page prefills `?token=`); 4 dead template imports removed from `notifications.ts`.
- **Docker engine Windows fixes** (`sandbox-engine/src/docker-engine.ts`): all docker invocations converted `exec` shell strings → `execFileAsync("docker", [args])` (cmd.exe `&`-splitting/single-quote bugs); container/lifetime/idle maps keyed by 12-char docker id (was UUID = every lookup missed); `--cap-drop` emits one flag per capability (comma-join was rejected by docker as one unknown capability); config `pidsLimit` honored; `MIN_PIDS_LIMIT=16` floor — on Docker Desktop (Windows) pids-limits below ~16 intermittently fail `docker exec` with `OCI runtime exec failed: procReady not received` once background children accumulate (empirically verified: 8 → ~60% failures with lingering children, 16 → 0/24); OCI-handshake retry (`execFileWithHandshakeRetry`, safe: exit 128 + marker ⇒ process never started) in `executeInContainer` + `startProcess`; `clearAll()` now async and actually `docker rm -f`s containers (previously cleared only in-memory maps and orphaned every container — leaked 2 per test run).

Verification evidence:
- Docker isolation suite **22/22 passing** (3 consecutive green runs) · **no container leaks** after runs (`docker ps -a --filter label=aiharness.sandbox=true` empty) · PID-limit test now asserts exec-started + `pidsCurrent ≤ 16` cap; process-count test (3× backgrounded `sleep`) green at floored limit.
- `npm run typecheck` EXIT=0 · frontend `tsc --noEmit` EXIT=0 · `npm run lint:frontend` EXIT=0 (0 errors, 2 pre-existing warnings).
- Full `npm test`: **456 passed / 1 failed / 54 skipped** — the 1 failure is the pre-existing mcp-platform ECONNREFUSED :9999; docker-isolation ran green inside the full run (22 tests, 74.6s). Acceptance suite still needs a live API on :4000 (collection error, pre-existing).
- Environment incident: C: hit 0.3 GB free → dockerd wedged twice (CLI hangs, ENOSPC during test writes). Freed ~3.2 GB (npm cache) + pruned 12.8 GB inside the Docker VM (build cache + dangling images). **Remaining optional step (needs an elevated shell):** compact the 37.6 GB `docker_data.vhdx` to reclaim ~20 GB:
  `wsl --shutdown` + Docker Desktop processes stopped, then `diskpart` script: `select vdisk file="%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx"` → `attach vdisk readonly` → `compact vdisk` → `detach vdisk`, then restart Docker Desktop.

---


---

## PHASE 7 - Acceptance suite green + production bug fixes (error mapping, cached Dates, UUID runId crash, orphan re-enqueue loop) - DONE

Scope delivered:
- **Acceptance suite (`backend/apps/api/tests/acceptance.integration.test.ts`) green against a live stack**: route fix `/v1/auth/register` -> `/v1/auth/signup` + `displayName`; task body now sends required `workspaceId` and `agentMode: "BUILD"` (API enum is BUILD/PLAN/ASK/REVIEW/FIX; "CODE" was invalid); project body relies on the new `rootReference` default; test 3 timeout raised to 90s (polls terminal state up to 60s).
- **Validation errors were 500s**: `plugins/error-handler.ts` only mapped AppError/ZodError/429, so Fastify ajv errors (FST_ERR_VALIDATION, statusCode 400) fell through to `INTERNAL_ERROR 500`. Added 4xx mapping -> 400 VALIDATION_ERROR / 401 UNAUTHENTICATED / 403 FORBIDDEN / 404 NOT_FOUND.
- **Contract drift fixed**: workspace create Fastify body schema required `executionMode` while `createWorkspaceRequestSchema` defaults it to "CLOUD" (zod is the source of truth; also what `scripts/e2e-integration-setup.ts` relies on) -> removed from `required`. Project create: `rootReference` was zod-required but the SDK declares it optional (`sdk.createProject`) -> now `z.string().min(1).max(2000).default("/")`.
- **Cached-Date 500s**: `withCache` JSON round-trips, so the 2nd `GET /v1/tasks/:taskId` within TTL returned `createdAt` as a string and `serializeTask` crashed (`toISOString is not a function`). `serializeTask` now accepts `Date | string` (covers the list route too); audit confirmed all other `withCache` consumers are date-safe (`toWorkspaceDto`/`serializePolicy` guarded; no direct `cacheGet` users).
- **UUID crash killing every start job**: `TaskEvent.runId` is `@db.Uuid` nullable but call sites passed `?? ""` -> Prisma "invalid length: expected length 32 for simple format, found 0" on the first pre-run publish (MEMORY_CONTEXT_LOADED etc.). Fixed `event-publisher.ts` to `input.runId || null` (DB write + emit) and all 4 orchestrator sites (`memory-aware-orchestrator`, 3x `multi-agent-orchestrator`) to `input.runId || null`. (`orchestrator.ts:164` already resolves the `""` sentinel to `randomUUID()` at run creation - only pre-run publishes were affected.)
- **Orphan re-enqueue infinite loop closed**: `worker.on("failed")` only logged/notified - tasks stayed QUEUED, and with BullMQ jobId `start-{id}` re-adding a **finished** job is a no-op, so the 30s sweeper re-enqueued the same tasks forever (observed: 9 tasks, `failed` count creeping). Added `finalizeFailedTask()` (task -> FAILED + completedAt, latest non-terminal run -> FAILED with JOB_FAILED, RUN_FAILED event via `runtime.events`, notification) called from `worker.on("failed")` **and** from the orphan sweeper, which now checks `statsQueue.getJob("start-{id}").getState()` per task: in-flight states are skipped, finished jobs finalize the task instead of no-op re-adding.

Verification evidence:
- Full `npm test`: **462 passed / 50 skipped / 0 failed, EXIT 0** (was 456 / 54 / 1).
- Acceptance suite **4/4 passing, twice**, against the live stack (API :4000 + worker).
- Orphan loop empirically closed: first sweep finalized all 9 stale tasks ("task marked FAILED" x9), second sweep 30s later emitted zero re-enqueue lines; queue stats stable.
- `npm run typecheck` EXIT=0 (after `UNAUTHORIZED` -> `UNAUTHENTICATED` ApiErrorCode fix); frontend `tsc --noEmit` EXIT=0; `npm run lint:frontend` 0 errors (2 known warnings); 168 doc links checked, 0 missing.
- Background services left running for continued work: API + worker (`npx tsx src/server.ts|src/worker.ts`, logs in `$env:TEMP\opencode\{api,worker}.{out,err}.log`); kill by matching CommandLine `server.ts|worker.ts`.

---

## PHASE 8 - E2E happy path proven: infinite approval loop closed, tool root scoping, CLOUD sandbox wired - DONE

Scope delivered (round A — approval/queue coherence):
- **TEST provider creation unblocked outside production**: `contracts/providers.ts` split into `createProviderObjectSchema` + `createProviderRequestSchemaWithTest` / `createProviderRequestSchema` (TEST rejected when `NODE_ENV=production`); `providers.routes.ts` picks the variant by env.
- **Occurrence-unique BullMQ jobIds** (re-adding a finished jobId is a silent no-op — observed: an approved plan never resumed): TaskJob payloads extended with `{kind:"resume-approved-plan"; planId}`, `{kind:"continue-after-tool-decision"; approvalId}`, `{kind:"revise-plan"; requestId}`; `task-queue.ts jobIdFor()` switch emits `resume-approved-plan-{taskId}-{planId}` etc. (start keeps stable `start-{taskId}` for dedupe); call sites in `plans.routes.ts`/`approvals.routes.ts` updated.
- **Resume-recovery sweeper** (worker.ts, fulfilling a previously false comment): finds `WAITING_FOR_APPROVAL` tasks whose latest plan is APPROVED; job in-flight -> skip, finished but still waiting -> finalize, absent -> re-add. Empirically recovered a stuck probe task immediately on restart.
- **Socket-plugin cache invalidation**: TASK_EVENTS_CHANNEL handler now invalidates `task:{id}` + `tasks:user:*` (worker writes bypassed `withCache`, causing ~15s stale GETs; measured visible lag 15s -> ~1s).

Scope delivered (round B — the infinite loop + tool execution path):
- **Infinite plan-approval loop root cause + fix**: `budget.replansUsed/toolCallsUsed/modelInvocationsUsed` were rebuilt as `0` on every resume entry (`startRun`, `approvePlanAndExecute`, `revisePlan`, `continueAfterToolDecision`), so `maxReplans=3` never accumulated across approval cycles — a failing plan looped forever (observed: 24+ replan versions on one task). New `buildRunBudget(ctx, runId)` reconstructs counters from persisted state (`taskEvent.count(REPLAN_STARTED)`, `toolCall.count(runId)`, `taskEvent.count(MODEL_INVOCATION_RECORDED)`) and is used at all 4 sites, so caps survive resumes and persistent failure now ends in FAILED via `MAX_REPLANS_EXCEEDED`.
- **Root scoping — every filesystem/git/terminal call used to fail validation**: tool schemas require `root` but nothing ever supplied it (models and the TEST adapter can't know it; no injection existed) -> harness zod `VALIDATION_ERROR` at durationMs 0 -> replan -> loop. Orchestrator now injects `project.rootReference` as `root` on every root-scoped step (main loop, pending-approved resume, proposals) via `withProjectRoot()` — **authoritative override, not fill-in**: a model-chosen root would otherwise mount arbitrary host dirs in the sandbox.
- **CLOUD_SANDBOX was unreachable dead code**: filesystem/git/terminal definitions are `LOCAL_BRIDGE`, so the composite resolver's docker branch (`sandbox.ts`, gated on `SANDBOX_MODE=docker`) never fired and CLOUD projects could never execute tools. Added optional `environment` to `ToolExecutionRequest` (harness: `request.environment ?? definition.environment`) + `executionEnvironmentFor()` in the orchestrator (`LOCAL_BRIDGE` definition + `CLOUD` project -> `CLOUD_SANDBOX`) wired into `runAllowedTool` (both call paths), the retryable-failure re-execute, and verification; INTERNAL tools and LOCAL_BRIDGE projects unchanged. Enabled `SANDBOX_MODE=docker` in `.env` (`node:22-alpine` pulled).
- **Verification used a bogus root**: `VerificationEngine.verify` ran `terminal.run` with `root: input.projectId` (a UUID, not a path) -> env failure -> verification FAILED -> replan. Now takes `root` + `environment` from the orchestrator (`project.rootReference`, sandbox-routed for CLOUD).
- **`getSafeRoot` crashed in ESM**: `require("node:path")/require("node:fs")` inside an ESM module -> ReferenceError before any sandbox call; replaced with real imports (`statSync`, existing `path`).
- Probe project `root_reference` set to a real workspace dir (`$env:TEMP\opencode\probe-workspace`) instead of `/`.

Verification evidence:
- **E2E happy path reaches COMPLETED** (fresh task `e67b8bd9-2656-4154-ad37-f5c278fa4cca`, TEST provider, plan-then-execute): 1 plan approval -> `filesystem.create` approved -> SUCCEEDED in docker sandbox (fixture.txt content verified on host mount) -> `filesystem.read` SUCCEEDED (no approval needed, READ) -> verification `cat fixture.txt` **PASSED** -> RUN_COMPLETED. Zero TOOL_FAILED, zero REPLAN_STARTED, driver finished in ~14s with `planApprovals=1 toolApprovals=1`.
- Old infinite-loop probe task (24+ replan versions) cancelled; abandoned test task cancelled.
- Full `npm test`: **462 passed / 50 skipped / 0 failed, EXIT 0** (incl. Docker Sandbox isolation suite green inside the run); `npm run typecheck` EXIT=0; frontend `tsc --noEmit` EXIT=0; `npm run lint:frontend` 0 errors (2 known warnings); eslint clean on all files touched this phase (incl. 2 pre-existing `prefer-const` errors in orchestrator.ts fixed). One transient flake observed mid-session: `sandbox-engine installDependencies` hit its 15s timeout under parallel full-suite load — passes in isolation (4.2s) and on the re-run; not a regression.
- Background services left running: API + worker restarted after the changes (worker log shows "AI Harness worker ready"); kill by CommandLine regex `server\.ts|worker\.ts`.

---

## PHASE 9 - Root lint clean (197 -> 0), functional gaps fixed - DONE

Scope delivered:
- **`npm run lint` (root eslint) exits 0**: was **197 errors** (99 `no-unused-vars`, 42+ `no-explicit-any`, 2 `no-require-imports`, plus `Function` type / empty-object / later-appearing errors), now **0 errors**. Approach: (1) `eslint.config.mjs` overrides - `no-console: off` for `backend/packages/cli/**` (CLI stdout is UI) and for test files (`backend/**/*.test.ts`, `backend/apps/api/tests/**`); (2) `eslint --fix` + a line-aware codemod removed 51 unused import specifiers; (3) ~60 manual unused-var fixes (unused args prefixed `_` per config, dead bindings dropped keeping side-effecting calls, unused consts removed); (4) all `no-explicit-any` replaced with real types (`Prisma.InputJsonValue` for JSON writes, union casts for enums, `unknown` for generic defaults, structural catch types, `never[]` rest for event callbacks); (5) the two `require("node:crypto")` calls hoisted to static ESM imports (`saml-parser.ts`, `csrf.ts`); (6) 14 `import {} from "..."` shells left by the codemod deleted.
- **Functional gap fixed - playground `temperature` was accepted (schema 0-2) but silently ignored**: added `temperature?: number` to `ModelRequest` and passed it through all five adapters (OpenAI, OpenAI-compatible x2 paths, Anthropic with clamp to [0,1], Google generate+stream, Ollama generate+stream); playground now forwards it.
- **Functional gap fixed - response cache ignored its own `statusCodes` option**: `responseCacheHook` now skips caching when `!statusCodes.includes(reply.statusCode)` (default `[200]`, so only 200s were ever intended); unused `parsed` binding removed.
- **Dead-code cleanup**: unused `factory` in `deployment-provider.routes.ts`, `sessionEngine` in `core/engine.ts`, `ALLOWED_TAGS` in `prompt-defense.ts`, `totalTokens` in `context-engine`, unused schemas in `webcontainer.routes.ts` (run/file-sync endpoints remain unimplemented stubs and use inline body types), `DefaultDeploymentProviderFactory` import.
- Type-safety upgrades: `Event<T = any>`/`EventHandler<T>` defaults -> `unknown` (event-bus has no external consumers), `AgentRegistration.metadata`/`GraphNode.metadata`/`ContextEntry.metadata` -> `Record<string, unknown>`, `ASTNode.value` -> `unknown`, `OrchestratorTask.result`/handler returns -> `unknown`, `MCPCapabilities.logging` -> `Record<string, unknown>` (was `{}`), browser-engine `browser`/`page` -> real `playwright` `Browser`/`Page` types, webcontainer `boot` dynamic import typed structurally instead of double-`any`, `spawn` options typed `SpawnOptions`.

Verification evidence:
- `npm run lint` **EXIT 0** (0 errors, 0 warnings); `npm run typecheck` EXIT 0; `npx tsc --noEmit -p frontend/tsconfig.json` EXIT 0; `npm run lint:frontend` EXIT 0 (0 errors, 2 known `no-img-element` warnings).
- `npm test`: **462 passed / 50 skipped / 0 failed, EXIT 0** (102.9s) - including the full 22-test Docker Sandbox isolation suite and the previously flaky `sandbox-engine installDependencies` test (passed in this run).
- Worklists: `$env:TEMP\opencode\lint3-pairs.txt` (final 49-error list, all resolved), codemod at `$env:TEMP\opencode\fix-imports.mjs`.

---

## PHASE 10 - Skip audit: every test now runs (512/512), contract gaps closed - DONE

Scope delivered:
- **Structural skip bug fixed**: `describe.skipIf(!serverAvailable)` in `load/multiplayer/sso/webcontainer.integration.test.ts` is evaluated at collection time, but `serverAvailable` was set in `beforeAll` — the value was always `false`, so **28 tests could never run**. Health probe moved to top-level `await` in all four files.
- **Auth signup was broken for tests (and mapped to 500)**: tests called nonexistent `POST /v1/auth/register` (real route: `/v1/auth/signup`) with a password failing policy (`testpass123` vs min-10 + upper + lower + digit) — and zod rejections were wrapped by `errors.internal` → **500 instead of 400**. Fixed: signup route + `Testpass123!` in tests; auth/deploy/sandbox catches now rethrow `ZodError` (global handler → `VALIDATION_ERROR` 400) and sandbox also rethrows `AppError` (its 9 catches previously turned `notFound`/`forbidden` into 500s).
- **WebContainer endpoints were stubs/bugs** (PHASE 9 left them unimplemented): `files`/`run` threw "not yet implemented", status crashed with `uuid = text` Postgres errors (raw queries missing `$1::uuid` casts) and `created_at`-vs-`createdAt` mapping (raw rows are snake_case), unknown-session status returned 500 not 404, and create 404'd on the test's nonexistent workspace. Now: per-session directory with path-traversal-safe file sync (`{synced}`), `child_process` command execution with 10s timeout (`{exitCode, stdout, stderr}`), `fileCount` in status, dir cleanup on shutdown, workspace-role checks on every session op, tests create a real workspace.
- **SSO contract gaps**: `GET /v1/workspaces/:workspaceId/sso/:configId` did not exist (404) — added; create now sets `enabled: true` (login endpoint requires `enabled`, and the update test disables it — login test moved before update to keep both assertions meaningful).
- **Multiplayer**: join/DELETE got 400 from `Content-Type: json` with empty body (test helpers now only set it when a body is sent) + join sent no body; cursor/selection cross-replica fan-out implemented via Redis pub/sub (`mp:broadcast` channel, own-replica skip, in-process fallback when Redis is down) — **TODO(multiplayer-scaling) closed**, WS sanity probe green (2 clients, cursor relay + presence).
- **Load-test robustness**: providers-unauth assertion accepts `401` **or** `429` (parallel workers share one IP; 429 is correct protection, not a failure).
- **Rate limits made testable**: new `RATE_LIMIT_GLOBAL_MAX` env (default 100/min, wired into `plugins/rate-limit.ts`); local `.env`/`.env.example` raised to signup 100/h, login 500/15min, global 1000/min with explanatory comments — **prod defaults unchanged**. Full-suite parallel runs were otherwise guaranteed 429s (signup budget was 5-10/hour).
- **Docs updated**: `docs/API.md` (rate-limit section, SSO routes corrected from nonexistent `/v1/sso/config` paths, new WebContainer + Multiplayer sections), `docs/troubleshooting.md` §4.2 (configurable global limiter + local override values), `docs/guides/self-hosting.md` §4.5 (defaults vs local values), `CONTRIBUTING.md` (API-dependent suites, `RUN_INTEGRATION=1`, rate-limit note).
- **Known limitation kept (not half-implemented)**: `TODO(bridge-proxy)` in `preview-panel.tsx` — remote-browser preview through the gateway requires an authenticated API proxy + full asset URL rewriting (HTML-only `srcDoc` would break subresources; gateway proxy requires the internal secret, so browsers cannot call it directly). Current UX degrades with an explicit hint; tracked as future work.

Verification evidence:
- `RUN_INTEGRATION=1 npm test`: **512 passed / 0 skipped / 0 failed, EXIT 0** — run twice (after skip fixes and again after the multiplayer fan-out change), 51 files, ~23s. Plain `npm test`: 490 passed / 22 skipped (the two `RUN_INTEGRATION` suites only).
- All gates green: `npm run lint` EXIT 0 · `npm run typecheck` EXIT 0 · frontend `tsc --noEmit` EXIT 0 · `npm run lint:frontend` EXIT 0 (0 errors, 2 known warnings).
- Manual probes: weak-password signup → **400** (was 500), valid signup → 201, SSO login → 200 with redirect URL, `x-ratelimit-limit: 1000` on live API, WS sanity OK.
- Services: API restarted with new env/code (health 200); worker untouched.

---

## PHASE 11 - F-13 enforcement gap, MCP discovery caching, multi-replica realtime proof - DONE

Scope delivered:
- **PRD F-13 violation fixed — disabled STDIO MCP servers could still receive calls**: `stdioViaBridge` (worker `sandbox.ts`) never checked `server.status`, and the composite resolver's STDIO branch returns before the base executor's status check — so disabling a server only blocked HTTP/SSE. Now rejects with `POLICY_DENIED` at the single choke point for bridge-mediated calls (matches the HTTP/SSE path). Covered by `backend/apps/worker/src/sandbox.test.ts` (4 tests: disabled STDIO → POLICY_DENIED before bridge, disabled HTTP → POLICY_DENIED, ACTIVE STDIO proceeds to bridge check, unknown → NOT_FOUND).
- **MCP discovery caching implemented (last open PHASE 4 code-only candidate)**: discovery extracted from `toggleMcp` into `backend/apps/api/src/lib/mcp-discovery.ts` — Redis cache `mcp:discovery:{serverId}` with 10-min TTL tagged by SHA-256 of the decrypted config (config change misses naturally; `PATCH` config and `DELETE` invalidate explicitly; failures never cached; 200-tool cap preserved; injectable deps for tests). 9 unit tests in `mcp-discovery.test.ts` (cache hit/miss, config-change miss, no failure caching, STDIO no-bridge, STDIO cross-cycle cache, cap, invalidation, hash stability, TTL sanity).
- **Multi-replica Socket.IO proof (last open PHASE 4 / FINAL_GAP_AUDIT "pending infra" code-verifiable item)**: new `scripts/e2e-two-replica-socket.ts` + `npm run e2e:replicas` — spawns a second API on `:4001` sharing Redis, connects clients to both replicas plus a non-subscribed control client, publishes a worker-style `TASK_EVENTS_CHANNEL` event straight to Redis, asserts both replicas deliver `task:event` to their local room, the control client gets nothing, and Redis reports ≥2 subscriber connections (one per replica). First run failed on `localhost` → `::1` resolution (fastify listens IPv4-only) — switched to explicit `127.0.0.1`.
- **Docs**: `docs/guides/mcp.md` §4.1 rewritten for the cache + F-13 status check + refreshed refs; `docs/API.md` now catalogues the full MCP surface (was 2 of 8 routes, guide said "not yet catalogued"); `docs/guides/self-hosting.md` §6 cites the replica proof. PHASE 4 candidate list checked off (cloud/SaaS/Terraform items remain external-only).

Verification evidence:
- `RUN_INTEGRATION=1 npm test`: **525 passed / 0 skipped / 0 failed, EXIT 0** (53 files — was 512/51; +13 new tests). Plain `npm test`: **503 passed / 22 skipped, EXIT 0**.
- `npm run lint` EXIT 0 · `npm run typecheck` EXIT 0 · frontend `tsc --noEmit` EXIT 0 · `npm run lint:frontend` EXIT 0 (0 errors, 2 known warnings).
- `npm run e2e:replicas`: **passed twice** ("cross-replica Socket.IO fan-out verified", 2 Redis subscribers, control client silent).
- Services restarted with the new code: API health 200, worker queue stats live.
- Remaining open items are exclusively external: cloud sandbox infra, Terraform apply + CI deploy to a real GCP project, Sentry/PostHog accounts (all listed in EXTERNAL_DEPLOYMENT_CHECKLIST.md).

---

## PHASE 12 - Docker distribution path: teammates run it on their laptops - DONE

Goal: a teammate clones the repo and runs the whole platform on their laptop with Docker only — proven end-to-end this session.

Root causes fixed (each one was a guaranteed first-run failure):
- **Containers had no secrets**: `docker-compose.yml` never set `env_file`, so `JWT_ACCESS_SECRET` / `ENCRYPTION_KEY` / `BRIDGE_INTERNAL_TOKEN` were absent in containers (all have zod min-length and no defaults → crash-loop). Added `env_file: .env` to api/worker/gateway, `BRIDGE_GATEWAY_URL: http://gateway:4010` overrides, and an api `healthcheck` (frontend gates on `service_healthy`).
- **`CSRF_SECRET` missing everywhere**: `plugins/csrf.ts` hard-throws in production when unset, but the variable existed in neither `.env.example` nor `.env`. Added to both (plus generated by `scripts/setup-env.mjs` — new one-command `.env` bootstrap with fresh secrets, idempotent, `--force` to rotate).
- **Workspace manifest COPY blocks stale**: images copied only ~10 of 54 workspace manifests → esbuild died on `@ai-harness/session-engine` etc. Regenerated all 56 blocks in `Dockerfile.api|worker|gateway` with `scripts/gen-docker-manifests.mjs` (line-based, re-runnable when packages are added). Also added the missing `COPY scripts/migrate.mjs` (migrate service was MODULE_NOT_FOUND).
- **npm nested workspace deps vanished in images**: `xstate` lives in `backend/packages/domain/node_modules`, which `.dockerignore` excludes. Final stage now seeds `COPY --from=deps /app/backend ./backend` before the source copies (Docker COPY merges, keeping the nested `node_modules`). Removed `xstate` from `build-backend.mjs` EXTERNAL (bundle it); added `@fastify/swagger-ui` to EXTERNAL (CJS uses `__dirname` for static assets → crashes when inlined).
- **Prisma client never generated in images**: no postinstall hook exists, so containers shipped ungenerated `@prisma/client` ("did not initialize"). Added `RUN npx prisma generate --schema=backend/prisma/schema.prisma` to all three backend Dockerfiles.
- **Production Redis check was a guaranteed false negative (code bug)**: `plugins/rate-limit.ts` called `await candidate.ping()` immediately with `enableOfflineQueue: false` — pinging before TCP connect completes always fails with "Stream isn't writeable", so every production boot threw "REDIS_URL must be reachable" even with a healthy Redis. Fixed: await a `ready`/`error` handshake (3s cap) before pinging; failed client is `disconnect()`ed (stops background reconnects, avoids unhandled `error`); permanent error sink attached at construction; `candidate` hoisted so catch can clean up.
- **Build reliability**: all 4 Dockerfiles use `--mount=type=cache,target=/root/.npm` + `--fetch-retries=5` (npm registry ECONNRESET during rebuilds).
- **`CSRF_SECRET` missing from the production deploy pipeline**: beyond `.env.example`, Terraform never injected it (`infra/terraform/variables.tf` had no `csrf_secret` variable yet set `NODE_ENV=production` → every Cloud Run deploy would crash-loop at boot) and `.github/workflows/deploy.yml` passed no `TF_VAR_csrf_secret`. Added the variable + `common_env` entry, both workflow env blocks, and the header secrets comment; `EXTERNAL_DEPLOYMENT_CHECKLIST.md` (`TF_VAR_csrf_secret`) and `docs/guides/self-hosting.md` §4.1 (4-row secrets table + "all four") updated. All 3 remaining copies of the stale inline `node -e` secret one-liner (README-clone in getting-started/examples/troubleshooting/self-hosting — none generated `CSRF_SECRET`) replaced with `node scripts/setup-env.mjs`; README gained "Option A — Docker" / "Option B — local dev" install sections.
- **Stale worker failures triaged**: `queue stats failed:9` were 9 BullMQ `start-*` jobs from ~23.5h ago, all hitting `event-publisher.ts` `invalid length: expected 32, found 0` (empty-string `runId`) — the exact bug fixed in PHASE 7 (`runId: input.runId || null`, event-publisher.ts:66-67); job args carried only a valid `taskId`, confirming legacy data. Jobs + failed set cleared; worker now reports `failed: 0` with zero error-level logs.
- **Frontend runtime config verified in-container**: entrypoint writes `public/env.js` (`window.__ENV__={API_URL:"http://localhost:4000"}`), HTML references it, `api-client.ts` prefers it with build-time fallback — API URL is injectable without image rebuilds.

Docker end-to-end proof (this session):
- `docker compose up -d --build` → **all 7 services**: postgres healthy, redis healthy, `migrate` Exited(0), api **healthy**, worker Up (queue stats flowing, completed>0), gateway Up ("AI Harness bridge gateway ready"), frontend Up.
- `GET http://localhost:4000/healthz` → `{"data":{"status":"ok","checks":{"database":"up"}}}`; both `:4000`/`:3000` owned by `com.docker.backend.exe` (no local dev processes interfering).
- `POST /v1/auth/signup` + `POST /v1/auth/login` through the container → 200 with user + tokens (migrations applied; Redis-backed limiter active — `x-ratelimit-limit: 100` headers present).
- `GET http://localhost:3000` → 200, 76 KB app shell.
- Docs: `docs/getting-started.md` new **"Quick start with Docker (teams)"** section (`setup-env.mjs` → `docker compose up -d --build` → localhost:3000, with status/logs/rebuild/stop cheat-sheet and port-conflict gotcha).

Verification evidence:
- `npm run lint` EXIT 0 · `npm run typecheck` EXIT 0 · frontend `tsc --noEmit` EXIT 0 · `npm run lint:frontend` EXIT 0 (0 errors, 2 known warnings).
- `RUN_INTEGRATION=1 npm test`: **525 passed / 0 skipped / 0 failed, EXIT 0** (53 files). Plain `npm test`: **503 passed / 22 skipped, EXIT 0**. (First full-suite attempt crashed in vitest's worker pool with transient `ERR_IPC_CHANNEL_CLOSED` right after the image builds — rerun green.)
- Service health after the rate-limit change: api container healthy (boot passes the production Redis check), worker/gateway logs error-free.




---

## PHASE 13 - Next-20 task plan - ?? PLANNED

### Foundation
1. Initial git commit + rename branch `master`->`main` (CI/deploy trigger on `main`); .gitignore audit (`.env`/`node_modules`/`dist`/`.next` verified ignored).
2. Remediate `npm audit`: glob CLI command injection (high, via @serwist) + hono moderate CVEs; re-verify frontend build + gates.
3. Full E2E regression battery against the Docker stack: e2e:smoke, e2e:bridge, e2e:agent, e2e:resilience, e2e:replicas, e2e:browser -> PHASE 13 evidence.
4. CI: Docker image build + compose boot health job (Linux runner) + `gen-docker-manifests --check`.
5. terraform fmt/validate locally (install) + CI step (HCL edited blind in PHASE 12).

### Close Cat-2 verification gaps (FINAL_GAP_AUDIT)
6. Execution-loop bounds unit tests (duration/tool-calls/model-invocations/replans exceeded).
7. Stuck-run recovery sweeper E2E (orphaned active run -> INTERRUPTED + event).
8. Reviewer gate flip E2E (mock reviewer REVISE/BLOCK -> park at approval; PASS -> release).
9. Adapter wire contract tests: Google GenAI + native Ollama vs local mock HTTP servers.
10. Password-reset/invite email E2E with mocked Resend + resend-webhook round-trip.
11. Docker sandbox real-task proof (opt-in compose profile mounting docker.sock, SANDBOX_MODE=docker) + self-hosting docs.

### Product gaps
12. Bridge proxy for preview panel (last code TODOs: preview-panel.tsx:136,655) - gateway POST /bridge/proxy -> bridge http.fetch + subresource rewriting.
13. Multi-instance local load test (compose scale api x2 + artillery) -> p95/error-budget report; upgrade audit Cat-2.
14. Worker stale-failure hygiene (auto-clean old failed/completed jobs + failed count in metrics).

### Docs backlog (DOCUMENTATION_BENCHMARK section 7)
15. docs/PROMPT_GUIDE.md (new, ~500 lines).
16. docs/MODELS_AND_PRICING.md + docs/BENCHMARKS.md (bench:replay/bench-scenarios numbers).
17. docs/RULES_AND_INSTRUCTIONS.md + docs/USE_CASES.md.
18. docs/ENTERPRISE_SETUP.md (new) + expand docs/getting-started.md (~600-line target).
19. Rewrites: CLI_GUIDE, SDK_GUIDE, EXTENSION_GUIDE per benchmark scope.
20. Release prep: CHANGELOG v0.1.0, refresh FINAL_GAP_AUDIT/IMPLEMENTATION_STATUS (Dockerfiles Cat-2->1, CSRF deploy fix, rate-limit fix), benchmark 17-gap tracker status.

External-only (not in the 20): GCP/terraform apply, Resend key, Sentry/PostHog - EXTERNAL_DEPLOYMENT_CHECKLIST.md.

### Execution log
- [x] 1 git  - [x] 2 audit  - [x] 3 e2e battery  - [ ] 4 CI docker  - [ ] 5 terraform
- [ ] 6 bounds  - [ ] 7 sweeper  - [ ] 8 reviewer  - [ ] 9 adapters  - [ ] 10 email  - [x] 11 sandbox
- [ ] 12 bridge-proxy  - [ ] 13 load  - [ ] 14 hygiene
- [ ] 15 prompt  - [ ] 16 pricing+bench  - [ ] 17 rules+cases  - [ ] 18 enterprise  - [ ] 19 guides  - [ ] 20 release

### PHASE 13 execution log (tasks 1-2)

- [x] 1 git — branch `master`->`main`, `.gitignore` verified (`.env`/`node_modules`/`dist`/`.next` all ignored), initial commit `a2e0024` (742 files, 0 left out). LF/CRLF: repo stores LF (autocrlf normalizes) — Docker-safe.
- [x] 2 audit — `npm audit --omit=dev` **11 -> 4** (critical `next` CVE batch cleared 15.2.4 -> **15.5.26**; `glob` 10.4.5 -> 10.5.0; `hono` -> 4.13.9; js-yaml/gaxios/qs fixed; `@playwright/test` 1.51.1 -> 1.63.0; `@serwist/*` 9.0.11 -> 9.4.1 which drops the exact-pinned vulnerable `browserslist@4.28.6` — 9.5.12 pinned it, npm root `overrides` do NOT reach workspace deps (npm bug), verified via `npm explain`). Full audit 28 -> 20.
  - **Accepted residuals (documented, non-exploitable in our usage)**: `postcss@8.4.31` nested exact-pin inside `next` (build-time processing of trusted project CSS only; clears via `next@16` upgrade — tracked); `uuid@9` in `@google/genai` chain (CVE needs attacker-controlled v3/v5/v6 buffer; gaxios calls `v4()` no-arg; uuid 11 is ESM-only -> would break CJS `require`). Dev-only residue: electron/electron-builder chain (ASAR integrity, node-tar critical via cacache/node-gyp), vitest mocker — dev tooling, not shipped.
  - Fallout fixed: `next build` regenerated `next-env.d.ts` with a `path` triple-slash -> `frontend/eslint.config.mjs` now ignores `next-env.d.ts` (generated file).
  - Verification: `npm run build` (all workspaces incl. **desktop electron NSIS+portable — asar lock gone**) EXIT 0; lint 0; typecheck 0; FE tsc 0; FE lint 0 err (2 known warn); `RUN_INTEGRATION=1 npm test` **525/525** (first rerun had 4 live-server files hook-timeout — transient fresh-install I/O storm; isolated rerun green, full rerun green 53/53 + 525/525).
- [ ] 3 e2e battery  - [ ] 4 CI docker  - [ ] 5 terraform  - [ ] 6-20 pending

### PHASE 13 execution log (tasks 3 + 11) — full E2E battery green + docker.sock sandbox

**Task 3 — Full E2E regression battery against the Docker stack (all green):**
- `e2e:smoke` **14/14 PASS** (re-run after all changes below).
- `e2e:agent` **COMPLETED** — real Ollama (`qwen2.5:3b` via `http://host.docker.internal:11434/v1`): signup → seeded project (script seeds `.data/workspaces/e2e-agent-*` with package.json + git init) → provider reachable → plan → approval → execution → **sandbox `git diff` verification PASSED** → RUN_COMPLETED.
- `e2e:replicas` PASS · `e2e:resilience` PASS · `e2e:bridge` PASS.
- `e2e:browser` **37 passed / 0 failed / 4 skipped** (conditional skips).
- Root causes found & fixed during the battery:
  1. **State machine**: `VERIFYING → REPLANNING` edge missing → replan-after-failed-verification threw `CONFLICT` (`domain/src/task-state.ts` + test + `docs/APP_FLOW.md` §15).
  2. **Planner**: verification commands must be directly runnable (no `cd`/placeholders) + exact registered `toolName` or omit (`agent-runtime/src/planner.ts`).
  3. **Orchestrator**: unknown/freedom `toolName` (e.g. "Text Editor") fell into instant replan — now falls back to model-driven `proposeNextAction` (`orchestrator.ts:613`).
  4. **Browser specs**: stale landing-copy/CTA expectations + strict-mode dup "Sign In" links (`frontend/e2e/shell.spec.ts`, `responsive.spec.ts`); error-region locator must filter out the route announcer (`auth.spec.ts`, `failure.spec.ts`).
  5. **`package-lock.json` missing ALL non-win32 platform entries for `@tailwindcss/oxide` and `@img/sharp`/`sharp-libvips`** (npm bug npm/cli#4828) → `next build` inside Docker failed "Cannot find native binding". `npm install --package-lock-only` repaired only `@next/swc`; the 19 oxide/sharp/libvips entries were generated by `.data/repair-lock.mjs` (+404/-105 total diff) and survive npm round-trips.
  6. **Middleware**: `/sw.js` and `/env.js` were 307-redirected to `/login` → SW "behind a redirect" + console parse errors (`frontend/src/middleware.ts` PUBLIC_ROUTES).
  7. **Pruned images**: `docker image prune -af` removed `node:20-slim` → cold pull blew 15s test timeouts in `docker-isolation.test.ts` (22/22 green after warm pull).

**Task 11 — Docker sandbox real-task proof (opt-in compose profile):**
- New `docker-compose.sandbox.yml`: docker.sock mount (read/write), `${PWD}/.data/workspaces:/var/lib/ai-harness/workspaces` bind, `SANDBOX_MODE=docker`, `SANDBOX_IMAGE: node:22`, `SANDBOX_WORKSPACE_DIR/HOST_DIR` + `${SANDBOX_WORKSPACE_HOST_DIR:?}` guard. Worker image gains `docker-cli git` (`Dockerfile.worker`).
- New `backend/apps/worker/src/workspace-paths.ts` (+7 tests): `hostPathFor`/`containerPathFor`/`workspaceKey`/`cloneUrlFor`/`isUnder` — **defense-in-depth**: every workspace-rooted host path validated against the allowed host root (traversal rejected before `docker run`).
- `sandbox.ts`: workspace materialization (git clone → git-init fallback, promise-cached), host/container path mapping on every exec, `filesystem.search/rename/delete` + full `git.*` executor set, `shq()` shell quoting, `GIT_CONFIG` safe.directory injection, temp files under `root/.aiharness-tmp`.
- `env.ts` + `.env`/`.env.example` + `.gitignore` (`.data/`) + `scripts/e2e-agent-run.ts` seeding; docs: `docs/guides/self-hosting.md` new §11 (usage, security warning, offline-verify note) + §10 limitation rewrite.
- Verified in-container: `DOCKER_OK`, all `SANDBOX_*` envs correct; e2e:agent executed plan steps **inside `node:22` containers** with verification passing.
- Security note (documented in §11): docker.sock mount = root-equivalent on the host — explicit opt-in, off by default, not in the base compose.

**Task 3/11 verification evidence:**
- `npm run typecheck` EXIT 0 · `npm run lint` EXIT 0.
- `RUN_INTEGRATION=1 npm test`: **54 files / 532 tests, 0 failed, EXIT 0**.
- All six E2E suites green (above). Disk note: `docker image prune` + builder cache freed 12.6 GB; `docker_data.vhdx` compaction still pending (needs elevated shell — command in PHASE 6 log).

### Qoder competitive analysis (2026-09) — adoption backlog (not in the 20)

Prioritized from a full Qoder feature comparison; we remain ahead on the 16-state machine, policy engine, self-hosted/bridge story:
1. **Repo Wiki** — `.aiharness/wiki/` living documentation auto-maintained by runs (Qoder's strongest adoption hook).
2. **Spec-driven flow** — plan steps carry acceptance criteria; verification engine asserts them (extends task #6-8).
3. **Goal-driven N-turn mode** — multi-goal sessions with automatic continuation (vs single-run today).
4. **Worktree execution environments** — per-run git worktrees for parallel isolated runs (cloud path).
5. **Mobile approval PWA** — push + approve/reject from phone (extends existing PWA shell).
6. **Scheduled/triggered tasks** — cron + webhook entry points into the queue.
7. **Per-action cost transparency** — token/cost per tool call surfaced in the activity timeline (pricing tables already canonical).
8. **Experts-mode productization** — role-specialist presets (reviewer/optimizer/architect) as first-class agent modes.
9. **`SKILL.md` skill format** — adopt the emerging portable skills convention for the instruction system.
10. **Agent teams CLI** — `ah agents` orchestration surface (long-term).
11. **Marketplace** — skills/extensions publishing (long-term, post v0.1.0).
