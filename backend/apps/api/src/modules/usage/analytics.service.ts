/**
 * Analytics Service.
 * Provides daily/monthly usage reports and anomaly detection
 * for the usage pipeline.
 */
import type { PrismaClient } from "@prisma/client";

export interface DailyReport {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  callCount: number;
  uniqueModels: number;
  topModel: { model: string; tokens: number } | null;
}

export interface MonthlyReport {
  month: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  callCount: number;
  dailyBreakdown: DailyReport[];
}

export interface Anomaly {
  type: "cost_spike" | "token_spike" | "usage_drop" | "new_model";
  severity: "low" | "medium" | "high";
  message: string;
  detectedAt: string;
  value: number;
  threshold: number;
}

/**
 * Build a daily usage report for a given workspace within a date range.
 */
export async function getDailyReport(
  prisma: PrismaClient,
  workspaceId: string,
  startDate: Date,
  endDate: Date,
): Promise<DailyReport[]> {
  const records = await prisma.usageRecord.findMany({
    where: {
      workspaceId,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      createdAt: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      estimatedCost: true,
      modelIdentifier: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byDate = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    callCount: number;
    models: Map<string, number>;
  }>();

  for (const r of records) {
    const date = r.createdAt.toISOString().split("T")[0]!;
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        callCount: 0,
        models: new Map(),
      };
      byDate.set(date, bucket);
    }
    bucket.inputTokens += r.inputTokens;
    bucket.outputTokens += r.outputTokens;
    bucket.totalTokens += r.totalTokens;
    bucket.estimatedCost += r.estimatedCost;
    bucket.callCount += 1;
    bucket.models.set(
      r.modelIdentifier,
      (bucket.models.get(r.modelIdentifier) ?? 0) + r.totalTokens,
    );
  }

  const reports: DailyReport[] = [];
  for (const [date, data] of byDate) {
    let topModel: { model: string; tokens: number } | null = null;
    for (const [model, tokens] of data.models) {
      if (!topModel || tokens > topModel.tokens) {
        topModel = { model, tokens };
      }
    }
    reports.push({
      date,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.totalTokens,
      estimatedCost: data.estimatedCost,
      callCount: data.callCount,
      uniqueModels: data.models.size,
      topModel,
    });
  }

  return reports;
}

/**
 * Build a monthly usage report with daily breakdown.
 */
export async function getMonthlyReport(
  prisma: PrismaClient,
  workspaceId: string,
  year: number,
  month: number,
): Promise<MonthlyReport> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);

  const dailyBreakdown = await getDailyReport(prisma, workspaceId, start, end);

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCost = 0;
  let callCount = 0;

  for (const d of dailyBreakdown) {
    inputTokens += d.inputTokens;
    outputTokens += d.outputTokens;
    totalTokens += d.totalTokens;
    estimatedCost += d.estimatedCost;
    callCount += d.callCount;
  }

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    callCount,
    dailyBreakdown,
  };
}

/**
 * Detect anomalies in usage data by comparing recent activity
 * against historical averages.
 */
export async function detectAnomalies(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<Anomaly[]> {
  const now = new Date();
  const anomalies: Anomaly[] = [];

  // Compare last 24h vs previous 7-day daily average
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentUsage = await prisma.usageRecord.aggregate({
    where: { workspaceId, createdAt: { gte: last24h } },
    _sum: { estimatedCost: true, totalTokens: true },
    _count: true,
  });

  const historicalUsage = await prisma.usageRecord.aggregate({
    where: { workspaceId, createdAt: { gte: sevenDaysAgo, lt: last24h } },
    _sum: { estimatedCost: true, totalTokens: true },
    _count: true,
  });

  const recentCost = recentUsage._sum.estimatedCost ?? 0;
  const recentTokens = recentUsage._sum.totalTokens ?? 0;
  const histCost = historicalUsage._sum.estimatedCost ?? 0;
  const histTokens = historicalUsage._sum.totalTokens ?? 0;

  // Daily averages (divide by 6 for remaining days in the week)
  const histDailyCost = histCost / 6;
  const histDailyTokens = histTokens / 6;

  // Cost spike: >3x daily average
  if (histDailyCost > 0 && recentCost > histDailyCost * 3) {
    anomalies.push({
      type: "cost_spike",
      severity: recentCost > histDailyCost * 5 ? "high" : "medium",
      message: `Cost in last 24h ($${recentCost.toFixed(2)}) is ${(recentCost / histDailyCost).toFixed(1)}x the daily average ($${histDailyCost.toFixed(2)})`,
      detectedAt: now.toISOString(),
      value: recentCost,
      threshold: histDailyCost * 3,
    });
  }

  // Token spike: >3x daily average
  if (histDailyTokens > 0 && recentTokens > histDailyTokens * 3) {
    anomalies.push({
      type: "token_spike",
      severity: recentTokens > histDailyTokens * 5 ? "high" : "medium",
      message: `Tokens in last 24h (${recentTokens}) is ${(recentTokens / histDailyTokens).toFixed(1)}x the daily average (${Math.round(histDailyTokens)})`,
      detectedAt: now.toISOString(),
      value: recentTokens,
      threshold: histDailyTokens * 3,
    });
  }

  // Usage drop: <10% of daily average (only if there was historical activity)
  if (histDailyCost > 1 && recentCost < histDailyCost * 0.1) {
    anomalies.push({
      type: "usage_drop",
      severity: "low",
      message: `Cost in last 24h ($${recentCost.toFixed(2)}) is significantly below the daily average ($${histDailyCost.toFixed(2)})`,
      detectedAt: now.toISOString(),
      value: recentCost,
      threshold: histDailyCost * 0.1,
    });
  }

  // New model detection: models used in last 24h not seen in past 7 days
  const recentModels = await prisma.usageRecord.findMany({
    where: { workspaceId, createdAt: { gte: last24h } },
    select: { modelIdentifier: true },
    distinct: ["modelIdentifier"],
  });
  const historicalModels = await prisma.usageRecord.findMany({
    where: { workspaceId, createdAt: { gte: sevenDaysAgo, lt: last24h } },
    select: { modelIdentifier: true },
    distinct: ["modelIdentifier"],
  });

  const histModelSet = new Set(historicalModels.map((m) => m.modelIdentifier));
  for (const rm of recentModels) {
    if (!histModelSet.has(rm.modelIdentifier)) {
      anomalies.push({
        type: "new_model",
        severity: "low",
        message: `New model detected: ${rm.modelIdentifier}`,
        detectedAt: now.toISOString(),
        value: 1,
        threshold: 0,
      });
    }
  }

  return anomalies;
}
