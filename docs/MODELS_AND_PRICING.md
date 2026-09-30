# Models and Pricing

AI Harness meters model usage in tokens and prices every model from a single
canonical table. This page is the full matrix — 50 priced models across 8
sources — plus the plan quotas that sit on top, worked cost examples, and
exactly where prices surface in the product.

> Routing, fallback chains, and cost-tracking internals live in
> [Models & Providers](guides/models-and-providers.md). This page does not
> repeat them; it answers "what does it cost?"

## Contents

- [How pricing works](#how-pricing-works)
- [Quick picks](#quick-picks)
- [The pricing matrix](#the-pricing-matrix)
- [Worked cost examples](#worked-cost-examples)
- [Plans and quotas](#plans-and-quotas)
- [Where prices appear in the product](#where-prices-appear-in-the-product)
- [Cost controls](#cost-controls)
- [Choosing a model per stage](#choosing-a-model-per-stage)
- [Local and free models](#local-and-free-models)
- [Updating prices](#updating-prices)
- [FAQ](#faq)

## How pricing works

One table drives everything:

```text
backend/packages/contracts/src/pricing.ts  →  MODEL_PRICING_PER_1K
```

- **Units:** USD per 1K tokens, separate input (prompt) and output
  (completion) prices. Multiply by 1,000 for the familiar per-1M figure.
- **Single source of truth:** the API's usage tracker, the playground cost
  estimate, `GET /v1/models`, and the cost-tracker package's default price
  maps all derive from this table — update a price in one place.
- **No markup:** the meter records the table price as-is. Subscription plans
  (below) are billed separately from token metering.

The charge for any single model call:

```text
cost = (inputTokens / 1000) * inputPriceUSD
     + (outputTokens / 1000) * outputPriceUSD
```

Unknown model ids (a route points at something the table has never seen) fall
back to a conservative default of **~$2 input / $8 output per 1M tokens** so
usage records are never free-floating. Known ids also resolve through legacy
aliases (`claude-3.5-sonnet`) and provider-prefixed forms (`openai/gpt-4o`)
before the fallback applies.

## Quick picks

| You need | Start with | Input $/1K | Output $/1K |
|---|---|---|---|
| Cheapest capable coder | `deepseek-chat` | 0.00014 | 0.00028 |
| Cheap high-volume worker | `gpt-4o-mini` | 0.00015 | 0.0006 |
| Cheapest long-context | `gemini-1.5-flash` (1M ctx) | 0.000075 | 0.0003 |
| Balanced default | `gpt-4o` / `claude-sonnet-4` | 0.0025 / 0.003 | 0.01 / 0.015 |
| Strongest reasoning | `claude-opus-4` / `o3` | 0.015 / 0.01 | 0.075 / 0.04 |
| Big-code refactors | `codestral-latest` (32K ctx) | 0.001 | 0.003 |
| Zero token cost | `llama3` (self-hosted) | 0 | 0 |

## The pricing matrix

All 50 ids priced by `MODEL_PRICING_PER_1K`. **Context** is filled from the
provider catalog served by `GET /v1/models` (the ids the product offers in
pickers); rows marked with `—` are priced for cost accounting (legacy aliases,
historical usage rows, ids not yet in the interactive catalog) but are not
currently selectable. **Catalog** marks the selectable ids.

Provider overview (catalog served by `GET /v1/models/providers`):

| Provider | Transport type | Catalog models | Price range (input $/1K) |
|---|---|---:|---|
| OpenAI | `OPENAI` | 7 | 0.00015 – 0.015 |
| Anthropic | `ANTHROPIC` | 4 | 0.0008 – 0.015 |
| Google AI | `GOOGLE` | 3 | 0.000075 – 0.00125 |
| Mistral | `OPENAI_COMPATIBLE` | 3 | 0.001 – 0.0027 |
| DeepSeek | `OPENAI_COMPATIBLE` | 2 | 0.00014 – 0.00028 |
| OpenRouter | `OPENAI_COMPATIBLE` | 3 | 0.00015 – 0.002 |

### OpenAI (14)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `gpt-4o` | 128,000 | 0.0025 | 0.01 | ✓ |
| `gpt-4o-mini` | 128,000 | 0.00015 | 0.0006 | ✓ |
| `gpt-4-turbo` | 128,000 | 0.01 | 0.03 | ✓ |
| `gpt-3.5-turbo` | 16,385 | 0.0005 | 0.0015 | ✓ |
| `o1` | 200,000 | 0.015 | 0.06 | ✓ |
| `o1-mini` | 128,000 | 0.003 | 0.012 | ✓ |
| `o3-mini` | 200,000 | 0.0011 | 0.0044 | ✓ |
| `gpt-4` | — | 0.03 | 0.06 | — |
| `gpt-4.1` | — | 0.002 | 0.008 | — |
| `gpt-4.1-mini` | — | 0.0004 | 0.0016 | — |
| `gpt-5` | — | 0.005 | 0.015 | — |
| `gpt-5-mini` | — | 0.0005 | 0.002 | — |
| `gpt-3.5-turbo-16k` | — | 0.003 | 0.006 | — |
| `o3` | — | 0.01 | 0.04 | — |

### Anthropic (18)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `claude-sonnet-4-20250514` | 200,000 | 0.003 | 0.015 | ✓ |
| `claude-opus-4-20250514` | 200,000 | 0.015 | 0.075 | ✓ |
| `claude-3-5-haiku-20241022` | 200,000 | 0.0008 | 0.004 | ✓ |
| `claude-3-opus-20240229` | 200,000 | 0.015 | 0.075 | ✓ |
| `claude-sonnet-4` | — | 0.003 | 0.015 | — |
| `claude-opus-4` | — | 0.015 | 0.075 | — |
| `claude-opus-4-1` | — | 0.015 | 0.075 | — |
| `claude-3-5-sonnet-20241022` | — | 0.003 | 0.015 | — |
| `claude-haiku-3-5` | — | 0.0008 | 0.004 | — |
| `claude-3-sonnet-20240229` | — | 0.003 | 0.015 | — |
| `claude-3-haiku-20240307` | — | 0.00025 | 0.00125 | — |
| `claude-2.1` | — | 0.008 | 0.024 | — |
| `claude-2.0` | — | 0.008 | 0.024 | — |
| `claude-instant-1.2` | — | 0.0008 | 0.0024 | — |
| `claude-3.5-sonnet` *(alias)* | — | 0.003 | 0.015 | — |
| `claude-3-opus` *(alias)* | — | 0.015 | 0.075 | — |
| `claude-3-sonnet` *(alias)* | — | 0.003 | 0.015 | — |
| `claude-3-haiku` *(alias)* | — | 0.00025 | 0.00125 | — |

### Google (5)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `gemini-1.5-pro` | 2,000,000 | 0.00125 | 0.005 | ✓ |
| `gemini-1.5-flash` | 1,000,000 | 0.000075 | 0.0003 | ✓ |
| `gemini-2.0-flash` | 1,000,000 | 0.0001 | 0.0004 | ✓ |
| `gemini-2.5-pro` | — | 0.00125 | 0.005 | — |
| `gemini-2.5-flash` | — | 0.00015 | 0.0006 | — |

### Mistral (4)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `mistral-large-latest` | 128,000 | 0.002 | 0.006 | ✓ |
| `mistral-medium-latest` | 32,000 | 0.0027 | 0.0081 | ✓ |
| `codestral-latest` | 32,000 | 0.001 | 0.003 | ✓ |
| `mistral-small-latest` | — | 0.001 | 0.003 | — |

### DeepSeek (2)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `deepseek-chat` | 64,000 | 0.00014 | 0.00028 | ✓ |
| `deepseek-coder` | 64,000 | 0.00028 | 0.00056 | ✓ |

### xAI (2)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `grok-3` | — | 0.003 | 0.015 | — |
| `grok-3-mini` | — | 0.0003 | 0.0015 | — |

### OpenRouter (3)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `meta-llama/llama-3.1-405b-instruct` | 131,072 | 0.002 | 0.006 | ✓ |
| `meta-llama/llama-3.1-70b-instruct` | 131,072 | 0.00052 | 0.00075 | ✓ |
| `qwen/qwen-2.5-coder-32b-instruct` | 32,768 | 0.00015 | 0.00025 | ✓ |

### Self-hosted (2)

| Model | Context | Input $/1K | Output $/1K | Catalog |
|---|---:|---:|---:|:--:|
| `llama3` | — | 0 | 0 | — |
| `mistral` | — | 0 | 0 | — |

## Worked cost examples

### One planning turn (120K in, 8K out)

| Model | Input | Output | Total |
|---|---:|---:|---:|
| `claude-sonnet-4` | 120 × 0.003 = $0.360 | 8 × 0.015 = $0.120 | **$0.480** |
| `gpt-4o` | 120 × 0.0025 = $0.300 | 8 × 0.01 = $0.080 | **$0.380** |
| `gpt-4o-mini` | 120 × 0.00015 = $0.018 | 8 × 0.0006 = $0.005 | **$0.023** |
| `deepseek-chat` | 120 × 0.00014 = $0.017 | 8 × 0.00028 = $0.002 | **$0.019** |
| `llama3` (local) | $0.000 | $0.000 | **$0.000** |

Roughly a **25× spread** from cheapest to strongest on the same turn — which
is why model routing matters more than prompt compression for cost control
([routing](guides/models-and-providers.md#model-routing)).

### High-volume classification (3K in, 500 out)

`gpt-4o-mini`: 3 × 0.00015 + 0.5 × 0.0006 = **$0.00075 per call** — about
75 calls for one cent.

### What a plan buys

A Free plan (1M tokens/month) holds roughly **seven** 128K-token planning
turns, or about **330** classification calls at the same ratio. This is the
honest arithmetic behind the quota table below.

## Plans and quotas

Token metering is plan-independent; **plans cap monthly consumption**
(both tokens and estimated dollars, whichever hits first):

| Plan | Price/month | Monthly tokens | Cost cap/month | Extras |
|---|---:|---:|---:|---|
| **Free** | $0 | 1,000,000 | $10 | Basic models |
| **Pro** | $49 | 10,000,000 | $100 | All models, priority support |
| **Enterprise** | $499 | 100,000,000 | $1,000 | Custom models, dedicated support, SLA |

- Quotas are tracked per workspace per calendar month
  (`UsageQuota`: `monthlyTokens` + `monthlyCost` vs the plan's limits).
- The **budget gate** that enforces spend limits at request time — separate
  from plan quotas — is documented under
  [Budget enforcement](guides/models-and-providers.md#budget-enforcement-the-real-gate).
- **How this differs from "AI credits":** there are no prepaid credit packs
  to buy, top up, or watch expire. You pick a plan, tokens are metered at the
  published matrix prices, and the plan's token/dollar caps are the only
  ceiling. Bringing your own provider key (BYOK) means the provider bills you
  directly — AI Harness still meters tokens for quotas, budgets, and
  visibility.

## Where prices appear in the product

**`GET /v1/models`** — every selectable model with prices and context:

```json
{
  "data": {
    "models": [
      {
        "id": "claude-sonnet-4-20250514",
        "name": "Claude Sonnet 4",
        "provider": "Anthropic",
        "providerId": "anthropic",
        "contextLength": 200000,
        "inputPrice": 0.003,
        "outputPrice": 0.015
      }
    ]
  }
}
```

**`GET /v1/models/providers`** — the same data grouped by provider, used by
connection setup screens.

**Playground** — each streamed response carries the model's
`pricing: { inputPrice, outputPrice }` and an estimated `cost` computed from
the response's token usage with the formula above.

**Usage records** — every completed model call writes a `UsageRecord` with
tokens + estimated cost (see
[cost tracking](guides/models-and-providers.md#cost-tracking)). Aggregations
are first-class endpoints: `GET /v1/usage/by-model`, `GET /v1/usage/by-task`,
`GET /v1/usage/trend`, `GET /v1/usage/cost-summary`, `GET /v1/usage/quota`,
plus `GET /v1/admin/usage` for platform operators.

**Model routes** — `PUT /v1/workspaces/:id/model-routes` binds a
`(stage, model, provider connection)` with priority and fallbacks; the cost
of a run is whatever its route chain actually invoked.

## Cost controls

Metering without guardrails is just an invoice generator. Four layers sit on
top of the price matrix (all workspace-scoped):

| Control | Endpoint | What it does |
|---|---|---|
| Plan quota | `GET /v1/usage/quota` | Current month's token + dollar usage against the plan caps |
| Cost summary | `GET /v1/usage/cost-summary` | Period total; the number the budget gate compares against |
| Cost breakdown | `GET /v1/usage/cost-breakdown` | Where spend went — by model, stage, day |
| Cost alerts | `GET /v1/usage/cost-alerts` | Threshold alerts before a limit becomes a surprise |
| Anomalies | `GET /v1/usage/anomalies` | Statistical outliers (a runaway task shows up here first) |
| Budget gate | (runtime, [enforcement](guides/models-and-providers.md#budget-enforcement-the-real-gate)) | Blocks work that would breach a configured spend budget |

Typical setup: pick the cheapest model per stage that still passes review
([guidance below](#choosing-a-model-per-stage)), set a budget gate at 80% of
the plan's cost cap, and wire cost alerts to the notification channel the
workspace already uses for approvals.

## Choosing a model per stage

Routes are configured per **stage** — `PLANNING`, `IMPLEMENTATION`,
`REVIEW` (plus fallbacks). Typical choices:

| Stage | Wants | Consider |
|---|---|---|
| `PLANNING` | Best reasoning; long context over speed | `claude-opus-4`, `o3`, `claude-sonnet-4` |
| `IMPLEMENTATION` | Balance of code quality, speed, price | `gpt-4o`, `claude-sonnet-4`, `deepseek-coder` |
| `REVIEW` | Fast, cheap, instruction-tight | `gpt-4o-mini`, `claude-3-5-haiku-20241022`, `deepseek-chat` |

Heuristics that actually move the bill:

1. **Context size dominates input cost.** A 100K+ turn on a flagship is
   dollars; the same turn on a mini model is cents.
2. **Fallbacks are budgets too.** A cheap primary with a flagship fallback
   fails over at flagship prices only when it must.
3. **Replans multiply.** Failed verifications rerun stages — keep
   `IMPLEMENTATION` on a mid-tier model unless the code demands more.
4. **Local models are free but slower** — check that your host has the VRAM.

Decision order, fallback chains, and retry behavior:
[Model routing](guides/models-and-providers.md#model-routing).

## Local and free models

Self-hosted models (`llama3`, `mistral`) are priced at **0** — usage records
still count their tokens for visibility, but the dollar cost is zero.
Bring-your-own-endpoint models via the `OPENAI_COMPATIBLE` provider type get
real table prices if their id is in the matrix, otherwise the ~$2/$8 per-1M
default. See [Local models](guides/models-and-providers.md#local-models).

## Updating prices

Prices change upstream. The update path:

1. Edit **only** `backend/packages/contracts/src/pricing.ts` — add new ids,
   adjust changed ones, keep legacy aliases (historical usage rows resolve
   through them).
2. If a model should become selectable, add it to the `PROVIDER_CATALOG` in
   `backend/apps/api/src/modules/models/models.providers.routes.ts`
   (id, display name, context length).
3. Nothing else: the usage tracker, playground, catalog endpoints, and
   cost-tracker maps all read the canonical table.

Prices are intentionally **approximate** — they track provider list prices,
not billing-system precision. Reported cost is an estimate; your provider
invoice is authoritative.

## FAQ

**Why is the table per 1K tokens when vendors quote per 1M?**
Legacy convention in this codebase (`MODEL_PRICING_PER_1K`). Divide a vendor's
per-1M price by 1,000 to compare; every endpoint returns the same per-1K
numbers so there is only one unit to reason about.

**Why do some matrix rows show `—` context or no catalog check?**
They are priced for cost accounting — aliases older usage rows recorded,
ids kept for history — but are not offered in product pickers today.

**What does an unknown model cost?**
~$2 input / $8 output per 1M tokens (conservative default), applied after
alias and `provider/model` prefix resolution fails.

**Do retries cost double?**
Every provider call that returns usage is metered. A retried request is two
provider calls, two records.

**Do plan quotas apply to BYOK (my own provider key)?**
Token *quotas* count every recorded usage regardless of who pays the
provider; the *dollar* side of a BYOK call is still estimated from the same
matrix so budgets and alerts keep working. You pay your provider directly.

**Does a larger context cost more per token?**
No — the price is flat per token regardless of context position or length.
Context size matters only in *volume*: a 150K-token turn bills 150K tokens.
[Compaction](guides/context-and-memory.md) reduces cost precisely by reducing
that volume.

**Can I see per-task cost?**
Yes — `GET /v1/usage/by-task` aggregates usage records by their `taskId`;
playground responses show the estimate inline.

**Are plan quotas per user or per workspace?**
Per workspace (workspace-scoped `UsageQuota`). Multiple members share the
plan's monthly caps.

**Where is the machine-readable model list?**
`GET /v1/models` (authenticated) — same data as the matrix's catalog rows.

---

Related: [Models & Providers](guides/models-and-providers.md) ·
[Prompt Guide](PROMPT_GUIDE.md) · [API Reference](API.md)
