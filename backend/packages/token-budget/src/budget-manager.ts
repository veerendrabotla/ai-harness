import type { TokenUsage, BudgetConfig, BudgetStatus } from "./types.js";

export class TokenBudgetManager {
  private config: BudgetConfig;
  private usageHistory: TokenUsage[] = [];
  private taskUsage = new Map<string, number>();

  constructor(config: BudgetConfig) {
    this.config = {
      dailyLimit: config.dailyLimit,
      monthlyLimit: config.monthlyLimit,
      perTaskLimit: config.perTaskLimit,
      alertThreshold: config.alertThreshold || 0.8,
    };
  }

  recordUsage(usage: TokenUsage): void {
    this.usageHistory.push(usage);
  }

  recordTaskUsage(taskId: string, tokens: number): void {
    const current = this.taskUsage.get(taskId) || 0;
    this.taskUsage.set(taskId, current + tokens);
  }

  getStatus(): BudgetStatus {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const dailyUsed = this.usageHistory
      .filter((u) => u.timestamp >= todayStart)
      .reduce((sum, u) => sum + u.total, 0);

    const monthlyUsed = this.usageHistory
      .filter((u) => u.timestamp >= monthStart)
      .reduce((sum, u) => sum + u.total, 0);

    const alerts: string[] = [];

    if (dailyUsed >= this.config.dailyLimit * this.config.alertThreshold!) {
      alerts.push(`Daily usage at ${Math.round((dailyUsed / this.config.dailyLimit) * 100)}%`);
    }

    if (monthlyUsed >= this.config.monthlyLimit * this.config.alertThreshold!) {
      alerts.push(`Monthly usage at ${Math.round((monthlyUsed / this.config.monthlyLimit) * 100)}%`);
    }

    return {
      dailyUsed,
      dailyRemaining: Math.max(0, this.config.dailyLimit - dailyUsed),
      monthlyUsed,
      monthlyRemaining: Math.max(0, this.config.monthlyLimit - monthlyUsed),
      alerts,
    };
  }

  canUse(tokens: number, taskId?: string): boolean {
    const status = this.getStatus();

    if (status.dailyRemaining < tokens) return false;
    if (status.monthlyRemaining < tokens) return false;

    if (taskId && this.config.perTaskLimit) {
      const taskUsed = this.taskUsage.get(taskId) || 0;
      if (taskUsed + tokens > this.config.perTaskLimit) return false;
    }

    return true;
  }

  getUsageHistory(): TokenUsage[] {
    return [...this.usageHistory];
  }

  clearHistory(): void {
    this.usageHistory = [];
    this.taskUsage.clear();
  }
}
