export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  timestamp: Date;
  model: string;
}

export interface BudgetConfig {
  dailyLimit: number;
  monthlyLimit: number;
  perTaskLimit?: number;
  alertThreshold?: number;
}

export interface BudgetStatus {
  dailyUsed: number;
  dailyRemaining: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  alerts: string[];
}
