import { randomUUID } from "node:crypto";
import { MODEL_PRICING_PER_1K } from "@ai-harness/contracts";
import type { CostEntry, CostSummary, CostConfig } from "./types.js";

/** Canonical per-1K input price map derived from @ai-harness/contracts. */
function canonicalInputPrices(): Record<string, number> {
  return Object.fromEntries(Object.entries(MODEL_PRICING_PER_1K).map(([model, p]) => [model, p.input]));
}

/** Canonical per-1K output price map derived from @ai-harness/contracts. */
function canonicalOutputPrices(): Record<string, number> {
  return Object.fromEntries(Object.entries(MODEL_PRICING_PER_1K).map(([model, p]) => [model, p.output]));
}

export class CostTracker {
  private entries: CostEntry[] = [];
  private config: CostConfig;

  constructor(config?: Partial<CostConfig>) {
    this.config = {
      pricePer1kPrompt: config?.pricePer1kPrompt || canonicalInputPrices(),
      pricePer1kCompletion: config?.pricePer1kCompletion || canonicalOutputPrices(),
      monthlyBudget: config?.monthlyBudget,
      alertThreshold: config?.alertThreshold || 0.8,
    };
  }

  resolvePrice(model: string, priceMap: Record<string, number>): number {
    if (priceMap[model] !== undefined) {
      return priceMap[model]!;
    }
    const lower = model.toLowerCase();
    const isLow = lower.includes("haiku") || lower.includes("mini") || lower.includes("flash");
    const isHigh = lower.includes("opus") || lower.includes("gpt-4");
    let isCompletion: boolean;
    if (priceMap === this.config.pricePer1kCompletion) {
      isCompletion = true;
    } else if (priceMap === this.config.pricePer1kPrompt) {
      isCompletion = false;
    } else if (priceMap["gpt-4o"] !== undefined) {
      isCompletion = priceMap["gpt-4o"] === this.config.pricePer1kCompletion["gpt-4o"];
    } else if (priceMap["claude-opus-4"] !== undefined) {
      isCompletion = priceMap["claude-opus-4"] === this.config.pricePer1kCompletion["claude-opus-4"];
    } else if (priceMap["grok-3"] !== undefined) {
      isCompletion = priceMap["grok-3"] === this.config.pricePer1kCompletion["grok-3"];
    } else {
      // fallback: infer by average value magnitude if map has entries
      const values = Object.values(priceMap);
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        isCompletion = avg > 0.01;
      } else {
        // empty map: default to prompt; caller should pass correct map reference for completion case,
        // but for robustness treat as prompt (low tier will still be checked)
        isCompletion = false;
      }
    }
    if (isLow) return isCompletion ? 0.005 : 0.001;
    if (isHigh) return isCompletion ? 0.075 : 0.015;
    return isCompletion ? 0.015 : 0.003;
  }

  recordUsage(model: string, promptTokens: number, completionTokens: number, taskId?: string, userId?: string): CostEntry {
    const promptCost = (promptTokens / 1000) * this.resolvePrice(model, this.config.pricePer1kPrompt);
    const completionCost = (completionTokens / 1000) * this.resolvePrice(model, this.config.pricePer1kCompletion);

    const entry: CostEntry = {
      id: randomUUID(),
      model,
      promptTokens,
      completionTokens,
      cost: promptCost + completionCost,
      timestamp: new Date(),
      taskId,
      userId,
    };

    this.entries.push(entry);
    return entry;
  }

  getSummary(startDate: Date, endDate: Date): CostSummary {
    const filtered = this.entries.filter(
      (e) => e.timestamp >= startDate && e.timestamp <= endDate
    );

    const byModel: Record<string, { cost: number; tokens: number }> = {};

    for (const entry of filtered) {
      if (!byModel[entry.model]) {
        byModel[entry.model] = { cost: 0, tokens: 0 };
      }
      byModel[entry.model]!.cost += entry.cost;
      byModel[entry.model]!.tokens += entry.promptTokens + entry.completionTokens;
    }

    return {
      totalCost: filtered.reduce((sum, e) => sum + e.cost, 0),
      totalTokens: filtered.reduce((sum, e) => sum + e.promptTokens + e.completionTokens, 0),
      byModel,
      period: { start: startDate, end: endDate },
    };
  }

  checkBudget(): { withinBudget: boolean; currentSpend: number; budget: number } {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const summary = this.getSummary(monthStart, now);

    return {
      withinBudget: !this.config.monthlyBudget || summary.totalCost <= this.config.monthlyBudget,
      currentSpend: summary.totalCost,
      budget: this.config.monthlyBudget || Infinity,
    };
  }

  checkBudgetOrThrow(): void {
    const { withinBudget, currentSpend, budget } = this.checkBudget();
    if (!withinBudget) {
      throw new Error(`Budget exceeded: spent ${currentSpend} of ${budget}`);
    }
  }

  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  clearEntries(): void {
    this.entries = [];
  }
}
