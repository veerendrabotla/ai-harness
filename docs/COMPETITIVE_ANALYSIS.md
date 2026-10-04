# Competitive Analysis — PolySwitch (polyswitch.io)

> Status: analysis complete — conclusions folded into the roadmap (see [Roadmap](../TODO_NEXT_PHASE.md)).
> Sources verified 2026-10-04: `polyswitch.io` (home, about, `llms.txt`), GitHub via API.
> This document is independent analysis of a third-party product; all claims about PolySwitch are attributed and dated. No PolySwitch content is reproduced beyond factual summaries.

---

## 1. What PolySwitch is

A solo-built, **consumer desktop app** (Windows `.exe` + Linux `.deb` today, macOS pending) that presents personal "AI teammate" bots — named personas you chat with — which can research, edit files, run a headless browser, connect to external apps, and execute scheduled background routines.

| Attribute | Claimed (their site, 2026-10-04) |
|---|---|
| Form factor | Native desktop runtime, system-tray style, "zero cloud custody" |
| Audience | Individuals, freelancers, small business ("busy creators and teams") |
| Models | BYOK: Claude, GPT-4o/Codex, Grok, offline LM Studio models |
| Connectors | "500+ apps" via MCP + Composio (Slack, Gmail, Notion, …) |
| Safety | 1-click approval cards before destructive actions |
| Automation | Scheduled routines (cron-like background jobs) + completion notifications |
| Pricing | Free forever (local models only) · Pro **$1.99/mo** billed $19.99/yr for first 100 users, 14-day refund, zero token markup |
| Distribution | GitHub releases, `curl \| bash` installer, marketing site with `llms.txt`/`llms-full.txt` AEO pair |

## 2. Verification notes (honesty checks)

- **Broken flagship link**: the footer's "Official GitHub Repository" (`github.com/tejasundeep/polyswitch`) does not resolve (404 via API). The actual artifacts live in **`tejasundeep/polyswitch-softwares`** — created **2026-09-04**, **0 stars**, **no license**, single release **v1.0.0 (2026-09-10)**, last push 2026-09-10.
- **Version mismatch**: site footer says `BUILD: v1.0.4 #429A` while releases only ever shipped `v1.0.0`.
- **Latency numbers are marketing**: "0.12ms IPC", "800ms+ cloud agents" are unaudited figures; treat as copy, not benchmarks.
- **Launch-timing claims**: "first 100 users", testimonials, and "save 58%" are typical launch mechanics — unverifiable.
- Product age: **~1 month**. Early, thin (one release), unlicensed.

**Verdict on their claims:** real enough to learn from, not yet mature enough to benchmark against. Their AEO play (`llms.txt` + `llms-full.txt`) is legitimate and mirrors our own approach.

## 3. Head-to-head

| Dimension | PolySwitch | AI Harness |
|---|---|---|
| Target user | Consumer / freelancer / solo founder | Development teams & platform/enterprise buyers |
| Form factor | Desktop app only | Web PWA + CLI + SDK + IDE extension + CI + Desktop (build scripts shipped) |
| Run isolation | Executes **directly on your desktop** with full disk access | **Docker sandbox or Local Bridge** with path confinement, capability drops, resource limits |
| Safety model | Binary 1-click approve before dangerous ops | **Tiered permission engine**: ALLOW / ASK / DENY policies, risk levels (READ/WRITE/DESTRUCTIVE/EXTERNAL), env guards, wiki write zones, security scan gate, scoped approvals |
| Planning | Not marketed | **Plan steps with acceptance criteria** + per-command `asserts` |
| Verification | Not marketed | **Coverage gate**: a run cannot settle as *verified* while any criterion is unproven (forces replan) |
| Team features | None (single-user desktop) | Workspaces, RBAC, invites/members, SSO/SAML, IP allowlist, audit trail, orgs |
| Observability | "History of completed jobs" | Usage metering (**no markup** — documented), cost alerts, event stream + replay, context budgets, benchmarks |
| Scheduling | **Scheduled routines** (headline feature) | ❌ No first-class recurring tasks (only internal cost-alert sweeps) — **gap** |
| Connectors | MCP + Composio ("500+") | MCP (HTTP/SSE/STDIO) + bridge discovery; no app-connector marketplace — **gap** |
| Notifications | "Notifies when job finished" | Email + in-app prefs + outbound webhooks (no "routine finished" framing) |
| Privacy story | **Headline**: zero cloud custody, BYOK wholesale | Documented (**no markup**, BYOK in `MODELS_AND_PRICING.md`) but **not surfaced as a headline** — gap in messaging |
| Self-hosting | N/A (it is your machine) | Docker Compose, GCP/Terraform, multi-replica, air-gap capable |
| Docs/AEO | `llms.txt` + `llms-full.txt` (5 pages of docs) | `llms.txt` + `llms-full.txt` with **drift gate**, 40+ docs, link-checked |
| Pricing transparency | Detailed tiers + refund on marketing site | Model price matrix + plan quotas in docs; **no public product pricing page** — gap |
| Maturity | 1 release, 0 stars, no license, broken repo link | 642 tests, CI 7/7, multi-phase E2E battery, released changelog |

## 4. What they do better — adopt these

1. **Lead with the economics.** "Pay providers wholesale, 0% token markup" is their strongest line. We already *behave* that way (metering records table price as-is; BYOK documented) — surface it in the README headline and docs hub, not just deep in `MODELS_AND_PRICING.md`.
2. **Lead with the privacy story.** "Zero cloud custody" resonates. Our equivalents — self-hosted deploy, LOCAL_BRIDGE mode, air-gap — are real and stronger (we add isolation *on top*). Make "your code never leaves your infrastructure" a headline claim.
3. **Scheduled routines.** First-class recurring tasks ("run this goal every morning") + completion notifications is a genuine feature gap for us. We have the queue infrastructure (BullMQ) and hooks to build on.
4. **Trust & legal surface.** Terms, privacy policy, security contact, status page. We have `SECURITY.md` in-repo; a public status/trust page is a GA prerequisite.
5. **One-line installer polish.** `curl -fsSL … | bash` + per-OS installers. We already build desktop targets (`desktop:build:win/mac/linux`) but publish nothing — packaging/publishing is the missing half.
6. **Approval-card framing.** Their copy ("you remain the conductor", clear consequence preview) matches our approvals UI; keep our richer scope/input summaries but ensure the *why* reads in one glance.

## 5. What we do better — defend & amplify these

1. **Verified completion, not vibes.** Plan acceptance criteria + verification coverage gate (PHASE 14/15) is something they don't attempt — a run literally cannot claim success while a criterion is unproven.
2. **Isolation, not raw access.** They run with full disk privileges; we run tools in a confined sandbox with risk-tiered policy. For any buyer past hobbyist, that difference is decisive — say it plainly.
3. **Team & enterprise plane.** RBAC, invites, SSO/SAML, IP allowlist, audit, orgs, multi-replica — absent on their roadmap as a single-user app.
4. **Multi-surface control plane.** Web, CLI, SDK, IDE, CI, Desktop over one API — they are a desktop client with no API/CI story.
5. **Cost & context observability.** Usage metering, cost alerts, context budgets, event replay, published benchmarks — their only number is an unaudited "0.12ms".
6. **Auditable lifecycle.** State machine, checkpoints/rollback, reviewer gate, wiki changelog of runs — "what did the agent do, and can we prove it" is our core thesis.

## 6. Conclusions

- **Different segments.** PolySwitch is a *consumer desktop companion*; AI Harness is a *team engineering control plane*. We should **not** chase their persona bots or consumer pricing — we should **absorb their messaging discipline** (economics, privacy, control) and **close two real feature gaps** (scheduling, connector breadth).
- **Convergence points** already on our side: BYOK/no-markup, approvals, MCP, local execution (Local Bridge), llms.txt AEO (we're deeper).
- **Their verification gaps are a warning to us too**: publish honest version/status info, keep legal/trust surfaces current, and never put unaudited latency numbers in marketing (our `BENCHMARKS.md` methodology bar stays).
- **No code changes fall out of this analysis directly**; the actionable items are roadmap entries:

| # | Action | Type | Priority |
|---|---|---|---|
| 1 | Headline BYOK + "no token markup" in README/docs hub | Docs | High (quick) |
| 2 | Headline self-host + Local Bridge privacy claim | Docs | High (quick) |
| 3 | Scheduled/recurring tasks + completion notifications | Feature | High |
| 4 | Publish desktop installers (win/mac/linux already build) | Release | Medium |
| 5 | App-connector story (composio-style catalog or curated MCP list) | Feature | Medium |
| 6 | Public status page + terms/privacy/security contact for GA | Ops | Medium |
| 7 | Public product pricing page (beyond model price matrix) | Docs/Marketing | Medium |

---

*Revisit after any PolySwitch release beyond v1.0.0 or when we ship scheduling — whichever lands first.*
