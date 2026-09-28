# AI Harness — Documentation Benchmark & Gap Analysis

> **Date:** 2026-09-25 · **Method:** Live `WebFetch` of 12 tools' actual docs sites + header probes + `llms.txt` / `sitemap.xml` measurement
> **Purpose:** What makes great docs, what every tool does, what every tool misses — so our docs miss nothing

---

## 1. Our Current Docs — Full Catalog

| Doc File | Lines | Depth | Audience | Last Touched |
|----------|------:|-------|----------|-------------|
| `docs/PRD.md` | 783 | Deep (principles, personas, 8 product principles) | Product | Initial |
| `docs/BACKEND_STRUCTURE.md` | 575 | Deep (per-package, schema §2-§22) | Backend eng | Initial |
| `docs/AGENT_RUNTIME.md` | 497 | Deep (12 components, tool pipeline, gates) | Runtime eng | Initial |
| `docs/APP_FLOW.md` | 443 | Deep (task lifecycle, FE/BE flows) | Product + eng | Initial |
| `docs/API.md` | 307 | Flat table (endpoints, envelopes, WS events) | API consumer | Initial |
| `docs/FRONTEND_GUIDELINES.md` | 273 | Medium (design tokens, shell) | Frontend | Initial |
| `docs/TECH_STACK.md` | 269 | Flat (versions, choices) | Onboarding | Initial |
| `ARCHITECTURE.md` | 357 | High-level tree + guarantees | Everyone | Updated |
| `ARCHITECTURE_AUDIT.md` | 224 | Verdict table | Reviewers | New |
| `EXTENSION_GUIDE.md` | 257 | Plugin lifecycle, manifests | Ext dev | Initial |
| `SECURITY.md` | 247 | Posture, posture table | Security | Initial |
| `PLATFORM_GUIDE.md` | 211 | Deployment surfaces | Platform | Initial |
| `SDK_GUIDE.md` | 206 | Client usage | SDK dev | Initial |
| `TOOL_GUIDE.md` | 195 | Tool registry, risks | Runtime eng | Initial |
| `AGENT_GUIDE.md` | 182 | 5-agent architecture, task lifecycle | Agent dev | Initial |
| `CLI_GUIDE.md` | 156 | Commands summary | CLI user | Initial |
| `CONTRIBUTING.md` | 141 | Process rule, phase log | Contributors | Appended |
| `README.md` | 111 | Overview → install → test → status | Everyone | Initial |
| `FINAL_GAP_AUDIT.md` | 106 | Cat 1-5 checklist | Reviewers | New |
| `IMPLEMENTATION_STATUS.md` | 97 | Subsystem per-color status | Reviewers | Initial |
| `EXTERNAL_DEPLOYMENT_CHECKLIST.md` | 93 | Cloud env, secrets, run commands | Deploy | New |
| `TODO_NEXT_PHASE.md` | 94 | Phase 1-4 log, append-only | Contributors | Appended |

**Total:** 22 files, ~132k characters, ~32k words  
**Hosting:** Plain markdown in repo — no site generator, no `llms.txt`, no search, no versioning

---

## 2. External Benchmark — 12 Tools Measured

| Tool | Docs URL (verified) | Hosting | Pages (EN) | Est. Words | Depth | `llms.txt`? |
|------|---------------------|---------|----------:|----------:|------:|------------|
| **Devin** | `docs.devin.ai` | Mintlify+Vercel | 488 | ~450k | 5 | `llms.txt` + `_llms/api.md` |
| **Replit** | `docs.replit.com` | Mintlify+Vercel | 408 | ~600k | 4 | `llms.txt` (4,921w index) |
| **Cursor** | `cursor.com/docs` | Custom Next.js+Vercel | 344 | ~300k | 3–4 | stub `llms.txt` + `sitemap.xml` |
| **Copilot** | `docs.github.com/en/copilot` | GitHub Docs (K8s+Varnish) | ~320 | ~380k | 5–6 | none |
| **Lovable** | `docs.lovable.dev` | Mintlify+Vercel | 252 | ~200k | 3 | `llms.txt` |
| **Claude Code** | `code.claude.com/docs` | Mintlify+Cloudflare | 197 | ~650k | 4–5 | `llms.txt` + `llms-full.txt` (9.9 MB) |
| **v0** | `v0.app/docs` | Fumadocs (custom) | 187 | 146k | 3 | `llms.txt` + `sitemap.md` + `agents.md` |
| **Codex** | `learn.chatgpt.com/docs` | OpenAI Next.js | ~140 | ~350k | 3–4 | `llms.txt` |
| **Cline** | `docs.cline.bot` | Mintlify+Vercel | 113 | ~135k | 3–4 | `llms.txt` + `llms-full.txt` + `mcp/server-card` + `agent-card` |
| **Aider** | `aider.chat/docs/` | GitHub Pages | 94 | ~100k | 2 | none |
| **Windsurf** | `docs.windsurf.com` | Mintlify | ~90 est. | ~80k | 3 | `llms.txt` |
| **Bolt.new** | `support.stackblitz.com` + in-app | Mixed | ~40 | ~30k | 2 | none |

**Largest English docs:** Devin (488) › Replit (408) › v0 (187) › Copilot (320) — but Copilot wins word-count due to i18n × 8 locales

---

## 3. What Makes Great Docs — Patterns That Win

### A. Structure Patterns (Information Architecture)

| Pattern | Best Example | What It Does | Do We Have It? |
|---------|-------------|--------------|----------------|
| Task-oriented homepage buckets | **Cursor** — Understand → Plan → Fix → Review → Customize → Connect | Not alphabetical — “job to be done” grouping | ⬜ No |
| Concepts → How-tos → Tutorials → Reference split | **Copilot** (ontology first, steps second) | Only large corpus benefits from this discipline | ⬜ No (flat) |
| Learn center (narrative) vs Reference (lookup) | **Cursor `/learn/*`** 12 guides, **Devin Tutorial Library** | Narrative you read linearly; reference you search | ⬜ No |
| Journey narrative (guided story) | **Replit** coffee-shop launch (10-step chat→research→plan→design→publish) | Emotional onboarding, outcome before architecture | ⬜ No |
| Quickstart as hero, not appendix | **Cline** 4-path install matrix (IDE/CLI/Kanban/SDK) + **Lovable** 10-min publish | First thing a dev hits — platform matrix, not single-path | ⬜ Weak (README install only) |
| Single-page CLI Bible | **Cline** `cli-reference` — 18 commands + JSON schema + permissions globs | One page to rule all CLI, not 7 fragments | ⬜ No |
| Provider matrix (30+ providers, 3 auth flavors) | **Cline** — best taxonomy | Every LLM provider+auth in one place | ⬜ No |
| Use-case gallery (outcome-focused) | **Replit** 26 workflows (source candidates → outreach draft) | Each page: prompt + data source + artifact | ⬜ No |

### B. Depth Patterns (Content Quality)

| Pattern | Best Example | What It Does | Do We Have It? |
|---------|-------------|--------------|----------------|
| Rules system deep doc (4 tiers + frontmatter matrix + globs) | **Cursor** `rules` page (~2,400w) | `alwaysApply × globs × description` behavior + recipe table | ⬜ No |
| Plan Mode as first-class concept | **Cursor** Shift+Tab toggle (research→questions→plan→approval) | Mode is not a flag — it's a workflow story | 🟡 Partial (AGENT_GUIDE mentions modes) |
| AI Credits billing pooled model | **Copilot** ($0.01, 1,900/3,900 pooled, cost-center limits) | Tokens → credits vocabulary | ⬜ No billing docs at all |
| Prompt engineering 6 rules | **Copilot** (general→specific, examples, break tasks, avoid ambiguity, indicate code, keep history) | One-page cheat sheet | ⬜ No |
| Per-tool tabs (VS Code/JetBrains/Xcode) | **Copilot** `chat-in-ide` 4 tabs | Same page, tool-specific shortcuts | ⬜ Single-path |
| SDK multi-package + skill | **Cline** `@cline/sdk = @cline/core/agents/llms/shared` + `npx skills add` | SDK as architecture you can build on | 🟡 SDK_GUIDE exists but shallow |
| Hub-Spoke arch explainer | **Cline** `sdk/architecture/hub-spoke` | Daemon vs workers explained | ⬜ No |
| Settings exhaustive table + example files | **Claude Code** (dev/team/org examples) | Every setting with type, default, scope | ⬜ No |
| Hooks lifecycle diagram | **Claude Code** 35 events + stdin JSON + matcher logic | Hooks are not a list — they're a diagram with phases | ⬜ No |
| Feature Maturity badges (Alpha/Beta/GA) | **Codex** | Instant trust signal per feature | ⬜ No |

### C. Discoverability Patterns (LLM & Search)

| Pattern | Best Example | What It Does | Do We Have It? |
|---------|-------------|--------------|----------------|
| `llms.txt` index | **Claude/Cline** (with `llms-full.txt`) | Full doc index ingestable by any LLM; `md` per page | ⬜ No |
| `llms-full.txt` single-file dump | **Claude** 9.9 MB, **Cline** via Mintlify | One fetch for full context | ⬜ No |
| `/.well-known/mcp/server-card.json` | **Cline** | MCP registry advertises itself | ⬜ No |
| `/.well-known/trust.html` | **Lovable** | Trust center as URL, not PDF | ⬜ No |
| Versioned + i18n (8 locales × Enterprise fork) | **Copilot** | Only one with true versioned + localized docs | ⬜ No (English only, no versions) |
| `/agent-card.json` + `/agent-skills/` | **Cline** | Agent marketplace discovery | ⬜ No |

---

## 4. What Every Tool MISSES (Gaps We Can Beat Them On)

| Gap | Tools That Have It | Tools That Miss It | Opportunity for Us |
|-----|-------------------|--------------------|--------------------|
| No unified quickstart that works for ALL surfaces (IDE+CLI+API+sdk) | Cline (best, but still 4 sections) | Cursor (fragmented), Copilot (6 quickstarts scattered) | **Single `Get Started` with surface toggle (like Cline tabs but for all 5 surfaces)** |
| No `llms.txt` / LLM ingestion surface | Mintlify hosts (Claude, Cline, Replit) have it | Copilot, Codex, Aider (GH Pages) missing it entirely | **Add `llms.txt` + `llms-full.txt` + `agent-card`** |
| No copy-as-markdown / reading-time / Open-in-ChatGPT buttons | None do this well | All | **Add word-count + reading time + copy-markdown + open-in-LLM per page** |
| Diagnostics-first troubleshooting (`doctor` hub) | Cline (`cline doctor`), Claude (`/doctor`) | Lovable, v0, Replit (shallow troubleshooting) | **Build `aiharness doctor` docs hub (structured diagnostics, not “common issues” dump)** |
| No single “MCP in 5 minutes” page | All scatter MCP across 4–6 pages | All | **Own this: unified MCP quickstart** |
| Search bloat: 300+ pages buried, no “Use case → Prompt” gallery with copy-paste | Only Replit has gallery | Lovable/v0/docs.devin.ai — search fragmentation | **Use-case gallery with copy-paste prompts (Replit does, but ours can be agent-task-oriented)** |
| Heavy enterprise tax: 40% of Copilot/Devin nav is enterprise noise for solo dev | Copilot, Devin | Lovable, v0, Replit balance better | **Progressive disclosure: individual path first, enterprise gated behind clear door** |
| No benchmark/leaderboard (quant) | Only Aider has Leaderboards (edit/refactor) | Claude, Codex, Copilot — none | **Publish harness benchmarks (SWE-bench style or internal)`** |
| No benchmark showing real failure data (50% real bugs in `send_feedback`) | Only Lovable spills `send_feedback` eng queue (~50% real bugs, 10 prod fixes/day) | All others hide failure rates | **Transparency section: what fails, how often, how we fix** |

---

## 5. What Our Current Docs Do Well (Keep)

- **AGENT_RUNTIME.md** — Deepest single-file runtime doc in benchmark (497 lines: 12 components + tool pipeline + gates). Comparable to `code.claude.com/docs/how-claude-code-works`
- **BACKEND_STRUCTURE.md** — Per-package structure (§2–§22) is clearer than Cursor's scattered arch docs
- **PRD.md** — Personas (A-D) + 8 product principles + problem statement — most products bury this
- **APP_FLOW.md** — Task lifecycle visuals — rare; most tools don't publish state machine
- **Phase log in TODO_NEXT_PHASE.md** (append-only, append-only rule) — disciplined. Keep.
- **DECISIONS.md** — Spec-conflict resolutions — transparent and uncommon (most projects don't log why they diverged from spec)

---

## 6. What Our Docs Lack (17 Gaps Grouped by Priority)

### 🔴 P0 — Foundational (must have before any user can self-serve)

| Gap | Borrow From | Where It Goes |
|-----|-------------|---------------|
| No Getting Started / Quickstart (scattered `npm install` in README only) | Cursor (best onboarding), Cline (4-path matrix) | New `docs/GETTING_STARTED.md` |
| No Prompt Engineering Guide | Copilot (6 rules) | New `docs/PROMPT_GUIDE.md` |
| No CLI single-page reference (flags, JSON output, permissions) | Cline (`cli-reference`) | Rewrite `CLI_GUIDE.md` (now 156 lines → 400+) |
| No Models & Pricing matrix | Cursor (50-row, per-model pages), Copilot (AI credits) | New `docs/MODELS_AND_PRICING.md` |
| No `llms.txt` / `llms-full.txt` / discoverability stack | Cline/Mintlify free; Claude 9.9 MB | Add `docs/llms.txt`, generate root `llms.txt` + `.well-known/` entries |

### 🟠 P1 — High-Value (competitive parity)

| Gap | Borrow From | Where It Goes |
|-----|-------------|---------------|
| No Rules/Instructions deep doc (4 tiers + frontmatter matrix) | Cursor (`rules` 2,400w) | Expand existing instruction/policy docs + new `docs/RULES_AND_INSTRUCTIONS.md` |
| No Provider Matrix (18–30 providers, 3 auth per provider) | Aider (18), Cline (30+) | Expand `docs/API.md` provider section or new `docs/PROVIDERS.md` |
| No Troubleshooting / Diagnostics hub (`doctor`) | Cline (`cline doctor`), Claude (`/doctor`) | New `docs/TROUBLESHOOTING.md` |
| No Enterprise Setup (SSO/SCIM/deployment patterns/zero retention) | Devin (deepest), Codex (governance) | Expand `SECURITY.md` + new `docs/ENTERPRISE_SETUP.md` |
| No SDK Getting Started (hub-spoke, quickstart, recipes) | Cline (26 SDK pages + `sdk-skill`) | Expand `SDK_GUIDE.md` (206→500 lines) |
| No Context Window explainer (interactive simulation) | Claude Code | New subsection in `AGENT_RUNTIME.md` or standalone `docs/CONTEXT_AND_MEMORY.md` |

### 🟡 P2 — Differentiation (beat every tool)

| Gap | Borrow From | Where It Goes |
|-----|-------------|---------------|
| No Use-case Gallery (26 templated workflows, each with prompt + data source + artifact) | Replit (26), Lovable (12 verticals) | New `docs/USE_CASES.md` |
| No Benchmarks / Leaderboard (quant reproducible harness) | Aider (unique) | New `docs/BENCHMARKS.md` |
| No Journey Narrative (guided emotional onboarding) | Replit (coffee-shop 10-step) | Front matter of `GETTING_STARTED.md` (story framing) |
| No Skills/Artifacts/Routines deep docs | Claude (`skills`, `artifacts`), Devin (`Knowledge/Skills/Playbooks`), Lovable (`skills`, `cross-project referencing`) | Expand `EXTENSION_GUIDE.md` + new `docs/SKILLS_AND_WORKFLOWS.md` |
| No Governance / Compliance API / Audit deep dive | Codex (compliance API/audit events) | Expand `SECURITY.md` + `docs/ENTERPRISE_SETUP.md` |
| No Migration Guide (“Import from another agent”) | Codex | New `docs/MIGRATION.md` |
| No Changelog / What's New digest (weekly) | Claude (`What's new: 13 weekly digests`), Devin (release notes 2024–2026) | New `CHANGELOG.md` |

---

## 7. Plan — What to Build

### New docs (7 files)

| # | Doc File | Source Inspiration | Lines Est. |
|---|----------|:------------------:|-----------:|
| 1 | `docs/GETTING_STARTED.md` | Cursor quickstart + Cline 4-path matrix + Replit journey | 600 |
| 2 | `docs/PROMPT_GUIDE.md` | Copilot 6 rules + Claude prompt library | 500 |
| 3 | `docs/MODELS_AND_PRICING.md` | Cursor per-model + Copilot AI credits | 400 |
| 4 | `docs/RULES_AND_INSTRUCTIONS.md` | Cursor rules matrix + Cline customization | 500 |
| 5 | `docs/TROUBLESHOOTING.md` | Cline `doctor` + Claude `/doctor` + Devin common issues | 600 |
| 6 | `docs/USE_CASES.md` | Replit 26 workflows + Lovable 12 verticals | 700 |
| 7 | `docs/BENCHMARKS.md` | Aider leaderboards (unique) | 400 |

### Rewrites / Major expands (7 files)

| # | Doc File | Scope | Lines Now → After |
|---|----------|:-----:|------------------:|
| 8 | `CLI_GUIDE.md` | Single-page CLI Bible + JSON schema + permissions globs | 156 → 500 |
| 9 | `SDK_GUIDE.md` | Hub-spoke arch + multi-surface quickstart + recipes | 206 → 600 |
| 10 | `SECURITY.md` | + governance/compliance (Codex) + enterprise matrix (Devin) | 247 → 500 |
| 11 | `EXTENSION_GUIDE.md` | + Skills vs Artifacts vs Routines taxonomy (Claude vs Devin vs Lovable) | 257 → 500 |
| 12 | `docs/API.md` | + provider matrix + billing vocabulary + per-tool tabs | 307 → 600 |
| 13 | `docs/ENTERPRISE_SETUP.md` | New: SSO/SCIM/deployment/compliance (from SECURITY.md + Codex/Devin) | 0 → 500 |
| 14 | `CHANGELOG.md` | Weekly digests, versioned, feature maturity badges | 0 → 400 |

### Upgrades for discoverability (3 files)

| # | Doc File | Source | Lines Est. |
|---|----------|:------:|-----------:|
| 15 | `llms.txt` (root) | Cline/Claude pattern | 80 |
| 16 | `llms-full.txt` (root, generated list) | Cline/Claude | 20 (index) |
| 17 | `.well-known/` entries (`mcp/server-card.json`, `agent-card.json`) | Cline | 40 |

### Existing docs kept (no churn)

| Doc | Why Keep |
|-----|----------|
| `AGENT_RUNTIME.md` (497) | Already deepest in benchmark; keep, append context-compaction + hook wiring |
| `BACKEND_STRUCTURE.md` (575) | Clearest per-package structure — keep |
| `PRD.md` (783) | Personas + principles — keep |
| `APP_FLOW.md` (443) | Task lifecycle visuals — keep |
| `FRONTEND_GUIDELINES.md` (273) | Design tokens — keep |
| `TECH_STACK.md` (269) | Version table — keep |
| `DECISIONS.md` (68) | Transparent spec conflicts — keep |
| `PLATFORM_GUIDE.md` (211) | Deployment surfaces — keep |
| `TOOL_GUIDE.md` (195) | Tool registry — keep |

**Total new/rewritten docs: 17 items, est. ~8,000 lines / ~45k words** — brings harness docs from 22 files / 32k words → ~35 files / ~77k words, competitive with Aider (90k) and approaching Cline (135k). Upper tier (Claude/Cursor/Copilot 300–800k) requires dedicated site generator (Mintlify/Fumadocs) — recommendation below.

---

## 8. Hosting Recommendation

| Option | What | Cost | Fits Harness Now? |
|--------|------|------|-------------------|
| **A. Keep markdown in repo** (current) | What we have — works, versioned, no build | $0 | Yes (today) — all 17 items can ship as `.md` files, discoverable via `docs/` + `llms.txt` |
| **B. Mintlify site** (like Claude/Code, Cline, Replit, Lovable, Devin) | `llms.txt` + `llms-full.txt` + MCP card + agent card + search free | $0–120/mo | When we want branded site + search — next phase |
| **C. Custom Next.js/Fumadocs** (like Cursor, v0, Codex) | Most control, heaviest lift | Eng cost | Overkill now |

**Recommendation:** Do **A** now (ship all 17 markdown files + `llms.txt`). Add **B (Mintlify)** as `P2 Next phase` when we want search + branded site — requires only `docs.json` + push.

---

## 9. Verification Checklist (must pass before calling this phase DONE)

- [ ] `npx tsc --noEmit` (docs don't affect TS, but must not break prior pass)
- [ ] Every new `.md` file has: `#` title, `##` sections, code examples with `bash`/`typescript` fences, no broken internal links (every relative markdown link resolves)
- [ ] `llms.txt` lists every doc file with one-line summary
- [ ] No doc duplicates content across files (push detail to one canonical file, link from others)
- [ ] Every gap in §6 P0/P1/P2 is addressed by one doc in §7
- [ ] Word count sanity: `Get-ChildItem docs/*.md,*.md | Measure-Object -Line` matches est.

---

> **Craft, not churn:** Ship the 7 new docs + 7 rewrites as clean markdown that reads well in GitHub. Mintlify is a hosting upgrade, not a content upgrade — content is king. No unnecessary churn of existing deep docs.
