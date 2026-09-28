export interface CostEntry {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  timestamp: Date;
  taskId?: string;
  userId?: string;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  byModel: Record<string, { cost: number; tokens: number }>;
  period: { start: Date; end: Date };
}

export interface CostConfig {
  pricePer1kPrompt: Record<string, number>;
  pricePer1kCompletion: Record<string, number>;
  monthlyBudget?: number;
  alertThreshold?: number;
}
