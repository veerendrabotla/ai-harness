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

## PHASE 13 - Next-20 task plan - DONE (all 20 tasks, 2026-10-01)

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
- [x] 1 git  - [x] 2 audit  - [x] 3 e2e battery  - [x] 4 CI docker  - [x] 5 terraform
- [x] 6 bounds  - [x] 7 sweeper  - [x] 8 reviewer  - [x] 9 adapters  - [x] 10 email  - [x] 11 sandbox
- [x] 12 bridge-proxy  - [x] 13 load  - [x] 14 hygiene
- [x] 15 prompt  - [x] 16 pricing+bench  - [x] 17 rules+cases  - [x] 18 enterprise  - [x] 19 guides  - [x] 20 release

### PHASE 13 execution log (tasks 1-2)

- [x] 1 git — branch `master`->`main`, `.gitignore` verified (`.env`/`node_modules`/`dist`/`.next` all ignored), initial commit `a2e0024` (742 files, 0 left out). LF/CRLF: repo stores LF (autocrlf normalizes) — Docker-safe.
- [x] 2 audit — `npm audit --omit=dev` **11 -> 4** (critical `next` CVE batch cleared 15.2.4 -> **15.5.26**; `glob` 10.4.5 -> 10.5.0; `hono` -> 4.13.9; js-yaml/gaxios/qs fixed; `@playwright/test` 1.51.1 -> 1.63.0; `@serwist/*` 9.0.11 -> 9.4.1 which drops the exact-pinned vulnerable `browserslist@4.28.6` — 9.5.12 pinned it, npm root `overrides` do NOT reach workspace deps (npm bug), verified via `npm explain`). Full audit 28 -> 20.
  - **Accepted residuals (documented, non-exploitable in our usage)**: `postcss@8.4.31` nested exact-pin inside `next` (build-time processing of trusted project CSS only; clears via `next@16` upgrade — tracked); `uuid@9` in `@google/genai` chain (CVE needs attacker-controlled v3/v5/v6 buffer; gaxios calls `v4()` no-arg; uuid 11 is ESM-only -> would break CJS `require`). Dev-only residue: electron/electron-builder chain (ASAR integrity, node-tar critical via cacache/node-gyp), vitest mocker — dev tooling, not shipped.
  - Fallout fixed: `next build` regenerated `next-env.d.ts` with a `path` triple-slash -> `frontend/eslint.config.mjs` now ignores `next-env.d.ts` (generated file).
  - Verification: `npm run build` (all workspaces incl. **desktop electron NSIS+portable — asar lock gone**) EXIT 0; lint 0; typecheck 0; FE tsc 0; FE lint 0 err (2 known warn); `RUN_INTEGRATION=1 npm test` **525/525** (first rerun had 4 live-server files hook-timeout — transient fresh-install I/O storm; isolated rerun green, full rerun green 53/53 + 525/525).

### PHASE 13 execution log (tasks 4 + 5) — CI docker boot + terraform fmt/validate

- [x] 4 CI docker — `ci.yml` gains the **`docker`** job: `gen-docker-manifests.mjs --check` → `setup-env.mjs` → `docker compose build` → `up -d` → health poll (API `/healthz` must include `"status":"ok"` + `"database":"up"`, frontend `:3000` must return 200, 60×5s budget, logs dumped on timeout) → migrate container `ExitCode == 0` → `down -v` teardown (`if: always()`).
  - `scripts/gen-docker-manifests.mjs` gained **`--check`**: compares generated content in-memory, exits 1 on drift with a re-run hint (verified: clean → 0, corrupted COPY line → 1, restore → 0).
  - **Fixed generator non-idempotency**: it stripped old manifest COPY lines but never the old 3-line header comment, so every run appended a duplicate header (+3 lines/run). Header lines are now filtered too; back-to-back runs are byte-identical (all 3 Dockerfiles back to 56 manifests, 0 diff vs commit).
  - Locally verified: migrate-exit step logic (`docker compose ps -aq migrate` → inspect `{{.State.ExitCode}}` = 0 on the live stack) and YAML parses with jobs `lint, typecheck, test, build, security, docker, terraform`.
- [x] 5 terraform — installed **1.11.4** locally (`required_version >= 1.11.4`; 1.9.8 was correctly rejected) and `fmt`/`init -backend=false`/`validate` all green. Fixed the PHASE 12 blind-edit damage:
  - **12 invalid single-line multi-arg blocks** (`{ a = x; b = y }` — `;` is not valid HCL) across `variables.tf` (region/db_tier/db_password/4 secrets/2 URLs/image_tag), `main.tf` (google_sql_database.app), `outputs.tf` (redis_host/db_private_ip) — all expanded to multi-line.
  - **`env = concat(...)` on Cloud Run containers is not an argument** ("did you mean a block of type env") — converted all 3 services (api/worker/gateway) to `dynamic "env"` + `for_each`/`content`.
  - `terraform fmt -recursive` applied (`fmt -check` clean); `ci.yml` gains the **`terraform`** job (hashicorp/setup-terraform pinned `1.11.4` → `fmt -check -recursive` → `init -backend=false -input=false` → `validate`).
  - `.gitignore` terraform section added (`.terraform/`, `*.tfstate*`, lock-info, `*.tfvars*`); **`.terraform.lock.hcl` is tracked** (provider pins — best practice).

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

### PHASE 13 execution log (tasks 6 + 7) — bounds unit tests + stuck-run sweeper E2E

- [x] 6 execution-loop bounds unit tests — new `backend/packages/agent-runtime/src/run-bounds.test.ts` (**7/7**): `DEFAULT_RUN_BOUNDS` regression anchor (30min/12/50/3); `assertBudget` passes fresh budget, throws `MAX_DURATION_EXCEEDED` past deadline, throws `MAX_TOOL_CALLS_EXCEEDED` exactly at the cap (49 ok, 50 throws), throws `MAX_MODEL_INVOCATIONS_EXCEEDED` exactly at the cap (11 ok, 12 throws); replan bound proven increment-then-check: attempt 3 proceeds into recovery (stops at providerUnavailable, NOT max-replans), attempt 4 throws `MAX_REPLANS_EXCEEDED` and `replansUsed` lands at `max+1`.
- [x] 7 stuck-run recovery sweeper — **extracted** the inline worker block (worker.ts:451) into `backend/apps/worker/src/stuck-run-sweep.ts` (`sweepStuckRuns`, injectable `now`/`limit`) so it is testable; behavior preserved, plus the unused `include: {task.state}` now guards a real edge: **terminal task + live run → run-only interrupt** (never flips a COMPLETED/FAILED task back out of terminal).
  - Unit: `stuck-run-sweep.test.ts` **4/4** — query shape (notIn terminal, `startedAt < now-15min`, take 20), interrupt + task park + `RUN_INTERRUPTED`/`WORKER_LOST` event + warn log, terminal-task guard (all 4 terminal states, no task update, no transaction), custom limit/clock.
  - E2E: new `scripts/e2e-stuck-run-sweep.ts` + `npm run e2e:sweep` — seeds user→workspace→project→task+run pairs (stale run backdated 16min, fresh control), runs the real sweep with the real `EventPublisher` against the live DB, asserts stale run/task `INTERRUPTED` + `pauseRequested` cleared + persisted `RUN_INTERRUPTED` event (`reason: WORKER_LOST`) + fresh pair untouched, full cleanup. **PASSED** ("ALL STUCK-RUN SWEEP CHECKS PASSED", exactly 1 run interrupted).
  - Gates: typecheck 0 · lint 0 · agent-runtime + worker suites **10 files / 60 tests** green.

### PHASE 13 execution log (tasks 8 + 9 + 10) — reviewer gate + adapter wire contracts + password-reset email E2E

- [x] 8 reviewer gate flip — new `backend/packages/agent-runtime/src/reviewer-gate.test.ts` (**4/4**), drives the real private `executionLoop` (empty APPROVED plan → verification → review) with shadowed subsystems (`runReview`/`verification.verify`/`state.transition`/`events`/`fireHooks`/`checkpoints`/`runSecurityScan` + mocked prisma): blocking findings + `blockOnReviewFindings: true` → rejects `{name: "REVIEW_BLOCKED"}` + `RUN_BLOCKED_BY_REVIEW` published + no `REVIEWING→COMPLETED` transition; blocking + policy OFF → releases `COMPLETED` (advisory); empty blocking → `COMPLETED`; review skipped (null) → `COMPLETED`. **Wording note**: audit said "park at approval" — actual semantics: the gate throws `REVIEW_BLOCKED` (registered failure_code) which the run driver surfaces as a failed run; parking-at-approval is the separate plan-approval flow. Tested behavior documented as-is.
- [x] 9 adapter wire contracts — new `backend/packages/model-adapters/src/wire-contract.test.ts` (**8/8**) against local mock HTTP servers: Ollama `POST /api/chat` request shape (system+user messages, `format:"json"` for PLAN, `num_predict`/`temperature`) + response mapping (usage/finishReason/model), `/api/tags` health, `NO_BASE_URL`, 500 → retryable `PROVIDER_ERROR`; Google `models/{model}:generateContent` URL + systemInstruction + generationConfig body + usage/finishReason mapping, health, `NO_CREDENTIAL`, 503 → retryable. **Fixes the tests forced**:
  - both adapters' catch blocks **swallowed their own AdapterError codes** (`NO_BASE_URL`/`NO_CREDENTIAL` rethrown as generic `PROVIDER_ERROR`) → `if (err instanceof AdapterError) throw err` in `generate`+`stream` of both adapters.
  - Google adapter gained `metadata.baseUrl` → `httpOptions.baseUrl` passthrough (mirrors Ollama; enables proxies/emulators/mocks).
  - documented SDK limitation in-test: `@google/genai@1.0.1` mldev converter drops `responseId` → `providerRequestId` is null on the Gemini-API (non-Vertex) path.
- [x] 10 password-reset email E2E — new `scripts/e2e-password-reset.ts` + `npm run e2e:reset` (**20/20**): spawns a local API (`NODE_ENV=development`, `PORT=4171`, `RESEND_WEBHOOK_SECRET` set) and drives the full flow over HTTP: token row unexpired/unused; **captured dev delivery-log token sha256-hashes to the stored tokenHash** (the email carries the exact token that works); anti-enumeration (unknown email: same 200 envelope, no token emitted, no extra row); single-use consumption (`usedAt` set, reuse → `VALIDATION_ERROR`); old password 401 / new accepted; pre-reset refresh token revoked; **resend-webhook round-trip** (bad HMAC → 401, signed `email.delivered` → 200 `received:true` + `email_delivery` QUEUED → DELIVERED). **Fixes**:
  - **ESM logger bug**: `auth-service.ts` `getLogger()` used a bare `require("pino")` → `require is not defined` under ESM (tsx, `type:module`) → silently degraded to a no-op logger, losing the dev token log AND resend failure logs → now `createRequire(import.meta.url)` (verified working: token captured on first run).
  - `.env` `RATE_LIMIT_RESET_PER_HOUR=500` (was commented out → zod default 5/IP/hour would throttle repeated runs; matches the signup/login overrides).
- Gates: `typecheck` 0 · `lint` 0 · `RUN_INTEGRATION=1 npm test` **EXIT 0 — 57 passed/1 skipped files, 533 passed/22 skipped tests** (first attempt had 3 contention flakes — load.test.ts 56% success, docker-isolation path-traversal, acceptance hook timeout — all 31/31 green in isolated rerun; full rerun green). Note: docker-isolation conditional skips fluctuate (22-26) between runs.



### PHASE 13 execution log (task 12) — bridge proxy for preview panel

- [x] 12 bridge proxy — last two code TODOs (`preview-panel.tsx:136,655`) removed; remote previews now stream through the Local Bridge instead of expecting the browser to reach the bridge host's localhost.
  - **Security model**: new shared `isLoopbackUrl()` (only `http(s)` → `localhost`/`127.x.x.x`/`::1`) enforced twice — gateway `POST /bridge/proxy` (service) and bridge `http.proxy` case (end of the tunnel, before any socket opens). The old `isSafeOutboundUrl` (blocks ALL private IPs) made previews unusable, so previews get the narrower loopback-only guard while general exec keeps the strict one. SSRF surface: arbitrary sites are **not** reachable through the proxy — only the instance's own preview origin.
  - **Gateway**: `POST /bridge/proxy` (bridge-token auth, correlates over WS like `/execute`); dedicated `makeRateLimiter(300)`/min for proxy vs `30`/min for exec; per-bridge WS message cap 60→300/min (≈2 msgs per proxied subresource).
  - **Bridge `http.proxy`**: binary-safe bodies — text-ish content-types ≤1MB forwarded as text (`bodyEncoding:"text"`), anything else base64 ≤700KB (fits the 1MB WS frame) with a `truncated` flag; loopback guard via `isLoopbackUrl`.
  - **API** (new `projects.preview-proxy.ts` + routes in `projects.preview.ts`): `POST /v1/projects/:projectId/preview/proxy-ticket` (auth + VIEWER + preview running) → stateless HMAC ticket `v1.<b64url(projectId)>.<exp>.<sig>` (JWT_ACCESS_SECRET + `safeEqual`, 2h TTL, binds project); `GET /preview/proxy` + `/preview/proxy/*` → ticket verify (constant-time, expiry, project match), target reconstructed from `req.url` after stripping the prefix + ticket param, origin must equal the instance's, `BridgeGatewayClient.proxy()` 15s timeout, `errors.bridgeDisconnected()` on failure; response: only safe headers forwarded (**no Set-Cookie/ETag**), `cache-control: no-store`, HTML/CSS rewritten with the ticket re-appended.
  - **Subresource rewriting**: `rewritePreviewHtml` — href/src/action/poster + `data-*` attrs, `srcset` (mixed internal/external entries kept), `<style>` blocks + `style` attributes via `url()`, `<base>` tags dropped, `<script>` content untouched; skips `data:`/`javascript:`/`#`/external origins. `rewritePreviewCss` — `url()`/`@import` rewritten unless absolute-external/data/hash.
  - **Frontend** (`preview-panel.tsx`): `apiUrl` imported; proxy-ticket query (`enabled` only for remote+active previews, `staleTime:1h`, retry 1); `iframeSrc = proxiedPreviewUrl ?? preview.data.url`; health check probes the proxied URL when remote; banner now says "Serving … through the Local Bridge proxy" / "Connecting…".
  - **Tests**: new `backend/apps/api/tests/preview-proxy.test.ts` **14/14** — ticket round-trip/expiry/project-binding/tamper; `toProxyUrl` absolute/relative/query/external/skip; HTML attr+srcset+style+`<base>` rewrite; CSS `url()` rewrite.
  - **Known limitations (service-worker path deferred by design)**: absolute-path `fetch()`/XHR generated at runtime inside the iframe is not rewritten (would resolve against the API host); Set-Cookie/ETag deliberately not forwarded; ETags bust the rewrite cache anyway.
  - Gates: `typecheck` 0 · `lint` 0 · FE `tsc` 0 · FE `lint` 0 err (2 known warn; fixed unescaped `'` from the new banner) · `RUN_INTEGRATION=1 npm test`: 54/59 files green in parallel + **5 contention flakes** (acceptance/sso/webcontainer `beforeAll` 15s hook timeouts, load 64% success, docker path-traversal timeout) → **all 49/49 green in isolated reruns** (4+11+7+5+22).

### PHASE 13 execution log (task 13) — multi-instance local load test

- [x] 13 load — compose-scaled **api x2** (`docker-compose.load.yml` override: `container_name: !reset null`, `ports: !override 4000-4001:4000`, `RATE_LIMIT_*` raised to 100k so the Redis limiter stays active without poisoning results) + **k6 v2.3.0** arrival-rate profile `backend/load-tests/multi-instance.js` (50/50 split by VU parity; 40% healthz / 30% signup+tasks / 20% login / 10% expected-401; `http.expectedStatuses` so 401s don't count as failures). Full report: **`backend/load-tests/multi-instance-report.md`**.
  - **Gate run (definitive): `K6_EXIT=0`, 5/5 thresholds `ok`** — 8,632 reqs, client p95 **199ms** / p99 **320ms**, 0.00% failed, 0 dropped; server load-phase p95 **200.6 / 204.5** per instance (n=3982/3881, max 547/563, **zero >1s**); distribution **50.5/49.5** (incoming +4387/+4293). Budget consumption: p95 27%, p99 13%, failures 0%.
  - **Capacity probe (spike 75 rps): `K6_EXIT=99` by design** — 15,805 reqs, **0.00% HTTP failures even while collapsing** (p95 5000ms client; server spike p95 **6328/7096**, p50 684/857, ~46% >1s, backlog drained ~20s). Ceiling for the auth-heavy mix = **between 50 (sustained) and 75 (collapse) rps**; endpoint attribution joins prove the tail is **argon2id** (signup p95 6753/7308, login 4613/5103) while `/healthz` stays flat (p95 55–71).
  - Tooling: `artillery@2.0.34` added (profile `loadtest.yml` + `loadtest-processor.js` fixing the `$randomNumber` 409 storm with unique emails) but artillery hard-crashes on this Windows host with `0xC0000409` (Windows/Node fast-fail, 3 occurrences, no JS stack) → **k6 is the definitive runner**, artillery profile kept for CI/Linux. Fixed a harness bug mid-task: cooldown `constant-vus` had no `sleep` → unthrottled ~219/s flood to one replica flattered p95; run discarded, `sleep(1)` added, re-run green.
  - Artifacts: `multi-instance.js`, `multi-instance-results.json`, `multi-instance-report.md`, `docker-compose.load.yml`, `loadtest.yml`, `loadtest-processor.js` (root `package.json` gains `artillery` devDep + `loadtest` script).
  - Audit: FINAL_GAP_AUDIT "Multi-replica load test" **Cat-2 row closed** (Cat 2: 11 → 10); cloud multi-instance load remains a Cat-5 infra item.

### PHASE 13 execution log (task 14) — worker stale-failure hygiene

- [x] 14 hygiene — Redis job-record retention + failed-count metrics across the worker/API:
  - **Auto-clean**: new `backend/apps/worker/src/queue-hygiene.ts` (`QUEUE_RETENTION`: completed >24h, failed >7d, hourly gate, 10k batch limit) wired into the worker's 30s sweep as an hourly block (same `globalThis` idiom as backup cleanup) that logs `metric: "queue_jobs_cleaned"` with per-state removed counts; errors → warn + retry next cycle. Worker's `statsQueue` also gained the producer retention caps (`removeOnComplete: 500`, `removeOnFail: 1000` — recovery enqueues previously kept records forever; API producer/email/scheduler queues already capped).
  - **Failed count in metrics**: `getQueueCounts()` in `lib/task-queue.ts` resolves counts through `TASK_QUEUE` — fixes the **admin stats reading `bull:ai-harness-tasks:*` (a prefix that never existed; queue is `task-lifecycle` → always zeros)**; `GET /metrics` (Prometheus) now appends `queue_jobs{state=...}` gauges incl. `failed` (omitted only if Redis is down); `GET /v1/admin/metrics` returns `queue: {waiting,active,completed,failed,delayed}` (zeros on outage); `GET /v1/admin/stats` uses the same helper (response shape unchanged).
  - **Tests**: `queue-hygiene.test.ts` 4/4 (grace/type/limit args, constants, idempotency, error propagation) + `tests/queue-metrics.test.ts` 3/3 (gauge emission incl. `failed`, zero-gauges, exposition format) → 7/7 new.
  - **Gates**: `typecheck` 0 · `lint` 0 · `RUN_INTEGRATION=1 npm test` **57/61 files parallel** + the 4-file contention group green in isolation (**27/27**). Root-caused instead of hand-waved: the #13 load runs **exhausted the SIGNUP rate-limit bucket (`ah-rl:*`, 100/hr/IP, Redis-backed so it survived container recreation)** → those suites' beforeAll signups got 429 → tokenless 401 cascade. Flushed `ah-rl:*` → signup 201 → 4/4 green. (Also explains similar historical beforeAll flakes — flush `ah-rl:*` after heavy load runs.)

### PHASE 13 execution log (task 15) — docs/PROMPT_GUIDE.md

- [x] 15 prompt — new **`docs/PROMPT_GUIDE.md` (504 lines / ~3.2k words)**, benchmark §7 item 2 ("Copilot 6 rules + Claude prompt library", target 500). Grounded in a full code-map of the real prompt architecture (context-engine `CONTEXT_PRIORITY` ranks + 120 KB budget + `<untrusted>` fences, `RUNTIME_SYSTEM_INSTRUCTIONS`, mode constraints, plan/revise/reviewer contracts, memory extraction rules, per-stage model routing) — every claim traced to source, two would-be-wrong examples caught during review (nonexistent `frontend/src/lib/tokens` path, false "email retry ladder" claim).
  - Structure: six rules (each with good/bad `text` fences applied to AI Harness surfaces) · anatomy table of what reaches the model + a "what is NOT in the prompt" section (policy/tool rules/knowledge base/`AGENTS.md` — the common misconceptions) · surface-choice decision table (goal vs constraints vs instructions vs policy vs memory vs mode) · **prompt library** (11 copy-paste recipes + 3-stage "vague → specific → fully specified" worked example + constraints showcase) · advanced (revision instructions, memory steering, model routing, compaction, "policy beats prompting") · anti-pattern table · quick reference.
  - Linked (all 8 file links verified resolving): concepts, context-and-memory, permissions-and-approvals, models-and-providers, AGENT_RUNTIME, APP_FLOW, examples/README, DOCUMENTATION_BENCHMARK. Indexed in `docs/README.md` (Guides table + surface chooser).
  - Gates: `typecheck` 0 · `lint` 0 · benchmark §9 checks (title/sections/fences/links/line-count) pass.



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

### PHASE 13 execution log (task 16) - docs/MODELS_AND_PRICING.md + docs/BENCHMARKS.md

- [x] 16 pricing+bench - two new docs covering benchmark §7 items 3 ("Cursor per-model + Copilot AI credits", est 400) and 7 ("Aider leaderboards", est 400).
  - **`docs/MODELS_AND_PRICING.md` (378 lines / 2.5k words)** - full **50-row price matrix** generated from the canonical `backend/packages/contracts/src/pricing.ts` (8 provider groups; Catalog ✓ column marks the 22 selectable ids from `PROVIDER_CATALOG` with their real context lengths); cost formula + worked examples (25x flagship-vs-cheap spread on a 120K planning turn; Free-plan arithmetic); plans table from `BILLING_PLANS` ($0/$49/$499 with token+cost caps); credits-vs-meters explanation (no prepaid packs); verified product surfaces - `/v1/models` sample response, `/v1/models/providers`, playground `pricing` + `cost`, and the concrete `/v1/usage/*` family (`by-model`, `by-task`, `trend`, `cost-summary`, `cost-breakdown`, `cost-alerts`, `anomalies`, `quota`, `/v1/admin/usage`); cost-controls table; per-stage guidance using real `MODEL_STAGES` (PLANNING/IMPLEMENTATION/REVIEW); price-update path; 9-item FAQ (incl. unknown-model fallback `~$2/$8 per 1M`, BYOK, flat-per-token pricing).
    Self-review caught and fixed 3 would-be-wrong claims: local-model quota assertion (softened to verified wording), a link promising "billing vocabulary" in API.md (section not yet written - relinked), and vague "dashboards aggregate" (replaced with real endpoint names after reading `usage.routes.ts`).
  - **`docs/BENCHMARKS.md` (365 lines / 2.5k words)** - Aider-style quant page: environment table (i5-1135G7 / 11.7 GB / Node 24 / Docker 29.4.3 / Compose 5.1.4 / k6 2.3.0), methodology rules (gate vs probe, client vs server percentiles, no cross-host comparisons) + glossary; **load profile with the real #13 numbers** (gate: 8,632 reqs, p95 199ms, 5/5 thresholds, 0.00% failed; probe: ceiling 50-75 rps, 0.00% errors while collapsing, endpoint attribution table); **budget-derivation table** (750/2500ms = worst observed x ~1.4 headroom); committed-artifact inventory; **bench:replay 7-run results table** (median p50 ~21.5ms, totals <=114ms, honest caveats: fresh-task streams 1-4 pages, deep-stream seeding unimplemented); scenario-suite harness documented with an **empty leaderboard template governed by 5 inclusion rules** - no fabricated model numbers (`.env` carries no model credentials by design; external-only); regression floor (default `npm test` 554 pass | 22 skip, 60/61 files, 17.11s) including the `ah-rl:*` flush recipe; reproduce block; dated run log; FAQ (why k6 over artillery: Windows `0xC0000409` crash; why limits raised; why a 99-exit run is published).
  - Benchmarks executed live while writing: `npm run bench:replay` x7 (all `REPLAY BENCH OK`, exit 0) + default `npm test` (exit 0).
  - Cross-indexed in `docs/README.md` (surface chooser + Guides + Reference rows). Link checks: MODELS 23/23 and BENCHMARKS 32/32 internal links resolve (files + heading anchors); fences are bash/text/json per §9; no duplication with `guides/models-and-providers.md` (routing/cost-tracking internals stay canonical there; new docs link instead).
  - Gates: `typecheck` 0 - `lint` 0 - §9 structural checklist (title/## sections/fences/links) pass for both files.

### PHASE 13 execution log (task 17) - docs/RULES_AND_INSTRUCTIONS.md + docs/USE_CASES.md

- [x] 17 rules+cases - two new docs covering benchmark §7 items 4 ("Cursor rules matrix + Cline customization", est 500) and 6 ("Replit 26 workflows + Lovable 12 verticals", est 700).
  - **`docs/RULES_AND_INSTRUCTIONS.md` (452 lines / ~3.4k words)** - the steering map, grounded in a full code-map (two parallel source explorations): **four honest tiers** - runtime system instructions (3 hardcoded strings + 6 role prompts + mode template), workspace instructions (versioned `workspace_instruction_versions`, 200k POST / 10k effective at create, rank 2 mandatory), task rules (goal rank 3 mandatory 10k, constraints rank 4 cut-first 10k, revision 10k, mode line), and **policy as tier 4 which never reaches the prompt** (6 WorkspacePolicy scalars with defaults/ranges, ToolPolicyRule fields, per-run immutable snapshots). Includes the benchmark's requested **frontmatter matrix as an honest mapping table** (Cursor alwaysApply/applyTo/description -> tiers; `applyTo globs` = explicitly unsupported with equivalents), a **negative-space section** (AGENTS.md/CLAUDE.md/.cursorrules not read - zero code refs; no project instructions; knowledge not injected), a **Cursor/Cline migration playbook** (7 steps + before/after), **worked policy PUT curl + JSON payload**, **"anatomy of one decision"** walkthrough (terminal.run -> ASK -> WAITING_FOR_TOOL_APPROVAL), recipe set (instructions skeleton, constraints micro-patterns, 4 policy shapes, task templates as reusable rules), **limits table** (14 caps incl. effective-vs-schema disagreements documented as effective), product surfaces, precedence rules, 7-item FAQ, related-reading map to canonical owners.
    Research flagged PROMPT_GUIDE's "constraints mandatory?" row as contradicting code (cut at rank 4) - documented per code, no contradiction propagated.
  - **`docs/USE_CASES.md` (699 lines / est 700)** - **26 entries in 13 buckets**, each with the same six fields (Problem / copy-paste Goal / Context / Artifacts / Permissions / Surface) per the benchmark spec (prompt + data source + artifact): bugfix(3), features(3), plan-first(2), refactor(3), tests(2), review(2), security(2), docs(2), cicd(2), safety/recovery(2), local(1), team(1), prompt-to-app(1 incl. the 10 real builder templates with their verificationCommands). All entries grounded in verified capabilities (5 agent modes, 24-tool registry risk tiers, CLI CI flags + exit codes, security-scan finding types, checkpoints/MCP/deploy tools, 30 tasks/hour limit, effective policy defaults) and cross-linked to the 8 deep example walkthroughs instead of duplicating them; ends with mode/surface quick-reference, "make an entry yours" (task templates), related reading.
  - Index rows added to `docs/README.md` (surface chooser + Guides table).
  - **Link verification (UTF-8-aware checker): RULES 31/31, USE_CASES 34/34, MODELS 23/23, BENCHMARKS 32/32 - 0 broken files/anchors** (GitHub-exact slugger incl. em-dash/backtick headings). Two initially-failing anchors fixed (double-hyphen slugs for em-dash and `rm -rf` headings).
  - Gates: `typecheck` 0 - `lint` 0.

### PHASE 13 execution log (task 18) - docs/ENTERPRISE_SETUP.md + getting-started expansion

- [x] 18 enterprise - new `docs/ENTERPRISE_SETUP.md` (benchmark §7 item 13, est 500) + `docs/getting-started.md` expanded to the est-600 target.
  - **`docs/ENTERPRISE_SETUP.md` (472 lines / 42 links / 0 broken)** - grounded in a full file:line capability audit: workspace-scoped SSO (okta/azure_ad/google/saml with real SAML signature verification, JIT provisioning with `SSO_MANAGED_MARKER`, tested in `sso.integration.test.ts`), SCIM 2.0 at `/v1/scim/*` (app-JWT auth; `/v1/admin/scim/*` absent - documented), the honest 3-role model (`OWNER|MEMBER|VIEWER`, 192 call sites - flags SECURITY.md's 4-row ADMIN table as stale), 26-permission org catalog, dual audit tables (35 AuditAction union + 84 legacy action strings, CSV export ≤10k platform-admin, retention 7-365 default 90 **manual cleanup**), AES-256-GCM `shared/crypto.ts` comma-list key rotation (no KMS), global IP allowlist preHandler, per-route rate limits, CSRF `ah_csrf` required in prod, helmet CSP with **no HSTS** (edge-TLS note), Terraform 12 resources. Plus: **3-phase rollout playbook** with verification checklist, **sizing table** derived from the measured benchmarks (50 rps p95 ~200ms, argon2 bottleneck, Cloud Run baselines), enterprise readiness matrix, curl recipes (SCIM, audit export, backup), env var reference, and the benchmark-required **"What does not exist" section** (LDAP, require-SSO enforcement, domain gating, frontend SSO button, custom roles/custom_roles table, workspace rate-limit config, scheduled audit purge, erasure/export, SOC2/HIPAA/DPA/zero-retention, Secret Manager/LB in TF).
  - **`docs/getting-started.md` (139 -> 579 lines / 52 links / 0 broken)** - preserved every original section (prereqs, Docker quickstart, 3-terminal manual path, provider connect, first task, verify, tests, production) and added: 10-move first-day list with timings, choose-your-path matrix, **platform-on-one-page architecture** + 5 guarantees, Docker service/port table, local-Ollama 4-command path, three copy-paste first goals (ASK/BUILD/PLAN), annotated state timeline, **narrated first-session walkthrough** (8 steps incl. the Request-revision loop), approvals-up-close table (plan/tool/security gates + scopes), tab-by-tab "what happened" walkthrough + checkpoint proof, **REST curl walkthrough** of the same first task, day-one poke table, 10-term glossary, **CLI first steps** (bin `aiharness` from `@ai-harness/cli`, verified `bin` field - removed a `build:cli` script claim that does not exist), **SDK first steps** (`AiHarnessClient` snippet verified against SDK_GUIDE), owner's-first-10-minutes workspace setup, `.env` cheat sheet, **10-row first-run problems table** (incl. `ah-rl:*` rate-limit flush after load tests, `127.0.0.1` vs `localhost`, CSRF/Redis boot fails), first-week curriculum, 9-item FAQ.
  - **Fixed a pre-existing broken anchor**: `concepts.md#planning-protocol` -> `#3-planning-protocol` (concepts headings are numbered).
  - Index: `docs/README.md` gains ENTERPRISE_SETUP in the surface chooser, Guides table, and a new "Admin / security owner" reading path.
  - **Link verification (UTF-8-aware checker): getting-started 52/52, ENTERPRISE_SETUP 42/42, docs/README 68/68 - 0 broken files/anchors.**
  - Gates: `typecheck` 0 - `lint` 0.


### PHASE 13 execution log (task 19) - CLI/SDK/EXTENSION guide rewrites + CLI/SDK contract fixes

- [x] 19 guides - benchmark section 7 rows 8/9/11 rewritten, and - because both guides documented APIs that did not work - the CLI/SDK contract bugs were fixed first, then proven green.
  - **Root cause found by code exploration**: every CLI task command (build/run/ask/plan/fix/deploy/CI) and thus the whole CI path failed with HTTP 400 because `createTask` never sent the server-required `workspaceId`; `sessions` called a non-existent `listSessions` route (404); `revisePlan` sent plural `instructions` (zod expects `instruction`); memory/restore used wrong paths; `streamEvents` fetched only the first 200 events and hung on terminal states; GitHub annotations used a malformed `::error::file,line::msg` format; API errors surfaced as `[object Object]`.
  - **`backend/packages/sdk/src/client.ts`**: `createTask` now requires `projectId` and auto-derives `workspaceId` via `GET /v1/projects/:id` (client-side SDKError 400 when omitted); `listSessions` -> `listTasks(workspaceId, {state?, limit?})` on `GET /v1/tasks`; `revisePlan` body singular `{instruction}`; `queryMemory`/`addMemory` -> `/v1/projects/:pid/memories` (plural, correct body, unwraps `{memories}`); `restoreCheckpoint` -> `rollbackCheckpoint` on `POST /v1/checkpoints/:id/rollback`; `streamEvents` paginates with `afterSequence` (200/page) and terminates on `COMPLETED|FAILED|CANCELLED|INTERRUPTED`; `SDKError` gains `code?` + envelope message extraction.
  - **`backend/packages/cli/src/index.ts`**: `--project` now required for build/run/ask/plan/fix/deploy/CI (clear usage error, exit 1); `flagValue()` rejects flag-looking values; `sessions` uses `listTasks` printing `state` + `goal`; usage text documents the real 7 flags. **`backend/packages/cli/src/ci.ts`**: GitHub annotation format fixed to `::error file=src/auth.ts,line=42::msg`.
  - **New tests**: `backend/packages/sdk/src/client.test.ts` (10/10 - workspaceId derivation, 400 without projectId, task list, revise body, memory routes, rollback route, event pagination/terminal, envelope errors) and `backend/packages/cli/src/ci.test.ts` (4/4 - GH annotation format + schema shape).
  - **Live E2E against the running stack (api :4000)**: SDK smoke (createTask auto-derives `workspaceId=ws` + task created, listTasks, memory roundtrip, health) and CLI `health`/`status`/`sessions`/`build` (previously 400 - now exit 0, task created)/`ask` without `--project` (exit 1 + usage).
  - **`CLI_GUIDE.md` rewritten (156 -> 476 lines / 12 links / 0 broken)** - single-page Bible: all commands with exact flags, the 7-flag table, CI mode with the exact CIResult JSON schema, GitHub annotation format, exit codes 0/1 (the nonexistent "exit 2" claim removed), permission globs, command->endpoint map, file-goal recipe, troubleshooting, 7-item FAQ.
  - **`SDK_GUIDE.md` rewritten (206 -> 558 lines / 24 links / 0 broken)** - hub-spoke guide: config, auth-by-curl (JWT-only - apiKey not a Bearer), 31-method reference with honest return-shape notes, events semantics (afterSequence + terminal states), error/retry matrix, multi-surface quickstarts (CLI/CI/IDE/Desktop), recipes, escape-hatch table, rate limits (30 tasks/hour), concurrency/versioning, type reference, 7-item FAQ.
  - **`EXTENSION_GUIDE.md` rewritten (257 -> 470 lines / 20 links / 0 broken)** - mechanism chooser, 10 extension types with honest wired/not-wired status, object-form manifest reference (capabilities/permissions as objects, matching ToolManifest), lifecycle + registries, "what is wired today" table, security model, 4 recipes + worked ToolExtension example + registration checklist, hook catalog, Skills/Artifacts/Routines taxonomy, publishing status, 7-item FAQ.
  - **Cross-doc corrections**: `docs/getting-started.md` CLI/SDK sections rewritten with verified commands (required `--project`, no `-f`, `status <task-id>`, exit 0/1, SDK `token:` config, `revisePlan(taskId, planId, string)`) - 53 links/0; `docs/USE_CASES.md` 12 fixes (8 command examples gained `--project`, 2x exit-code claim, false "replaces reviewer" claim -> honest code-change wording, deploy surface line) - 34 links/0; `TOOL_GUIDE.md` manifest arrays -> objects; `PLATFORM_GUIDE.md` `apiKey:` -> `token:` + removed nonexistent `npm install -g`; sweep grep clean (no `npm install -g @ai-harness`, `exit 0/1/2`, `ah_live_`, `restoreCheckpoint`, `listSessions`, `accessToken:` left in docs).
  - **Link verification (UTF-8-aware checker): CLI_GUIDE 476/12/0, SDK_GUIDE 558/24/0, EXTENSION_GUIDE 470/20/0, getting-started 53/0, USE_CASES 34/0 - 0 broken files/anchors** (est 500/600/500 per benchmark section 7 - estimates, not gates).
  - Index rows confirmed in `docs/README.md` (surface chooser + Guides table).
  - Gates: `typecheck` 0 - `lint` 0 - **full `npm test` 63 files / 590 tests (568 passed, 22 skipped) exit 0** (includes the 14 new CLI/SDK tests).

### PHASE 13 execution log (task 20) - release prep: CHANGELOG, audits, benchmark tracker

- [x] 20 release - the four deliverables of the release-prep line, plus the two buildable discoverability items so the tracker could honestly say shipped.
  - **CHANGELOG v0.1.0** (111 -> 130 lines): dated 2026-10-01 (no git tag existed - this is the first cut); added the PHASE 12/13 material the entry was missing - Docker bootstrap (`setup-env.mjs`, team quickstart), CI `docker`/`terraform` jobs + validated stack, a new "Preview, operations and load" group (bridge proxy, queue hygiene, k6 multi-instance, the six new docs + three rewrites), a new **Fixed** section (rate-limit production Redis handshake, `CSRF_SECRET` end-to-end, image contents, six E2E-battery root causes, ESM logger + adapter error codes, the CLI/SDK contract fixes, `npm audit` 11 -> 4), and a Security bullet for the loopback-only preview proxy with HMAC tickets.
  - **FINAL_GAP_AUDIT** refreshed: **8 Cat-2 rows -> Cat 1** with direct evidence (password-reset `e2e:reset` 20/20; Google+Ollama wire-contract 8/8; bounds 7/7; sweeper unit 4/4 + `e2e:sweep`; reviewer gate 4/4; Docker sandbox `e2e:agent` in `node:22`; Dockerfiles compose-build/boot + CI `docker` job); deploy workflow Cat 2 -> **5** (externally blocked only, fmt/validate green + `TF_VAR_csrf_secret` wired); header last-refreshed line; summary recount **machine-verified against the tables: Cat 1: 52 / Cat 2: 0 / Cat 3: 0 / Cat 4: 0 / Cat 5: 4 (56 rows)**; closed-bullets added for the PHASE 12 rate-limit + CSRF root-cause fixes.
  - **IMPLEMENTATION_STATUS** refreshed: stale claims corrected (56 tests/9 files -> **590/63**; MCP "STDIO unsupported" -> bridge E2E proven; Monaco "pending" -> swapped in; Sentry "init pending" -> env-guarded init; Deployment section split into 3 green rows) + new **PHASE 12-13 additions** section (9 bullets: distribution path, guaranteed-failure fixes, preview proxy, six verification closures, E2E battery + root causes, load test, worker hygiene, CLI/SDK fixes, docs coverage).
  - **Benchmark 17-gap tracker**: `docs/DOCUMENTATION_BENCHMARK.md` section 7 tables now carry a **Status column** (updated 2026-10-01) - **14 shipped / 2 partial / 1 not built**: SECURITY deep-dive delivered via ENTERPRISE_SETUP instead of editing SECURITY.md (247 unchanged); API.md partial (351; provider-matrix/billing tabs deferred); `.well-known/` cards deliberately not shipped (no consumer; an MCP server-card would misrepresent the platform - AI Harness is an MCP client/proxy, not a server).
  - **Discoverability items built**: `llms-full.txt` generated (**42 docs / 14,378 lines**) by new `scripts/gen-llms-full.mjs` (`npm run docs:llms-full`, `--check` drift gate mirrors the manifest-generator pattern); `llms.txt` completed - now lists **all 42 docs** (verified file-list vs link-set: 42/42, 0 dangling) with a pointer to llms-full.
  - **Section 9 verification**: found and fixed a root-path bug in the link checker (`Join-Path` on an empty dir silently skipped every link in root-level files) and re-ran it across **all 42 markdown files + llms.txt -> 43 sources, 0 broken files/anchors** (retroactively re-validating CLI/SDK/EXTENSION whose earlier counts came from the buggy run). Word sanity: 11,018 markdown lines (docs 7,730 + root 3,288).
  - Gates: `typecheck` 0 - `lint` 0 - **full `npm test` 63 files / 590 tests (568 passed, 22 skipped) EXIT 0**.

### CI/CD health repair (post task 20) - first fully-green CI run — DONE

- [x] CI repair line - user asked "what next"; a CI audit showed the pipeline had **never passed on any push**, so the next workstream was making every GitHub gate green with evidence.
  - **Diagnosis chain**: `25d6e1f` added `prisma generate` before typecheck + a deploy preflight job (typecheck/lint/build/security/terraform + deploy all green on run `36839545781`), leaving Test (P3018/42P01 `relation "users" does not exist`) and Docker boot (migrate exit 1) red.
  - **Root cause 1 - broken migration history**: two backdated migrations (`20240101000000_add_2fa_and_platform_admin`, `20240101000000_add_platform_admin_sso_rate_limits`) sorted before `20260825164734_init`; both were **baselined locally without ever executing** (`applied_steps_count=0` - local schema came from `db push`), they duplicate `PlatformRole`/`organizations`/`organization_members`/`audit_log_entries` between them, and the 16 files only created **~50 of schema.prisma's 63 tables**. No external database exists (terraform never applied), so the history was squashed to a single **`20261001000000_baseline`** (1,739 lines, `prisma migrate diff --from-empty --to-schema-datamodel`) - commit `1bcc8e0`; local `_prisma_migrations` cleared + baselined, `db push` cleared the 4-statement local drift (FK cascade + 2 indexes). Verified: fresh `postgres:17.4` deploy **exit 0, 63/63 tables, zero drift, `migrate status` clean**.
  - **Run `36843011664`** proved the fix (Test's `Prisma generate + migrate` green for the first time) and exposed the next layer: Test failed on `acceptance.integration.test.ts` (ECONNREFUSED - the only live-API test **missing the standard module-load health probe + `describe.skipIf` guard** used by load/multiplayer/sso/webcontainer) and `engine.test.ts` (Windows-only `type` command); Docker boot failed with an **unhealthy api container** - and the workflow tore down without capturing logs.
  - **Root cause 2 - production bundle SyntaxError**: rebuilt the api image locally and reproduced exactly - `SyntaxError: Identifier 'createRequire' has already been declared` at `dist/api/index.js:105730`. The esbuild **banner** in `scripts/build-backend.mjs` injected `import { createRequire } from "module"` while `auth-service.ts` imports it from `"node:module"` - duplicate top-level identifier in the ESM bundle. Invisible in dev (`tsx` runs unbundled source); only the Docker production bundle hits it, which is why local boots were healthy for 15h while CI's api crash-looped within 1.5s. Banner bindings now `__`-prefixed; verified `healthz 200 {"status":"ok","database":"up"}` on the host bundle **and** in the rebuilt compose stack.
  - **Supporting fixes**: acceptance test gained the skip guard; engine test picks `type`/`cat` per platform; CI `Boot stack` step now prints `docker compose ps -a` + 200-line service logs on failure instead of failing silently; stale local images rebuilt (fresh `.env` via `setup-env --force`, backup removed).
  - Gates: `typecheck` 0 - `lint` 0 - **full `npm test` 63 files exit 0** (acceptance ran live against the rebuilt stack) - **CI run `36854455231`: ALL 7 jobs green (Lint, Terraform, Typecheck, Security, Build, Test 3m15s, Docker compose boot health 6m21s) - the first fully-green CI run in the repo's history** - deploy run `36854455221` success. Commits: `1bcc8e0` (baseline squash), `524824a` (three CI failures).
  - Known flake: one early local `npm test` exited 1 with fully-filtered (unrecoverable) output; two subsequent full runs green - watch if it recurs.