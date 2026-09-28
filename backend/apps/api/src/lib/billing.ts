/**
 * Billing Service.
 * Usage-based billing enforcement and quota management.
 */
import type { PrismaClient } from "@prisma/client";
import { errors } from "@ai-harness/shared";

export interface UsageQuota {
  workspaceId: string;
  monthlyTokens: number;
  monthlyCost: number;
  monthlyTokensLimit: number;
  monthlyCostLimit: number;
  periodStart: Date;
  periodEnd: Date;
  plan: string;
}

export interface BillingPlan {
  id: string;
  name: string;
  monthlyTokensLimit: number;
  monthlyCostLimit: number;
  pricePerMonth: number;
  features: string[];
}

// Available billing plans
export const BILLING_PLANS: BillingPlan[] = [
  {
    id: "free",
    name: "Free",
    monthlyTokensLimit: 1_000_000,
    monthlyCostLimit: 10,
    pricePerMonth: 0,
    features: ["1M tokens/month", "$10 cost limit", "Basic models"],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyTokensLimit: 10_000_000,
    monthlyCostLimit: 100,
    pricePerMonth: 49,
    features: ["10M tokens/month", "$100 cost limit", "All models", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyTokensLimit: 100_000_000,
    monthlyCostLimit: 1000,
    pricePerMonth: 499,
    features: ["100M tokens/month", "$1,000 cost limit", "Custom models", "Dedicated support", "SLA"],
  },
];

export function getPlanById(planId: string): BillingPlan {
  return BILLING_PLANS.find((p) => p.id === planId) ?? BILLING_PLANS[0]!;
}

/**
 * Get current usage period dates.
 */
function getCurrentPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

/**
 * Resolve the effective plan for a workspace by reading from the Subscription table.
 * Falls back to "free" if no active subscription exists.
 */
async function resolveWorkspacePlan(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<string> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      workspaceId,
      status: { in: ["ACTIVE", "TRIALING"] },
    },
    select: { plan: true, status: true },
  });
  return subscription?.plan ?? "free";
}

/**
 * Get workspace usage quota for current period.
 */
export async function getWorkspaceUsage(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<UsageQuota> {
  const { start, end } = getCurrentPeriod();

  const usage = await prisma.usageRecord.aggregate({
    where: {
      workspaceId,
      createdAt: {
        gte: start,
        lte: end,
      },
    },
    _sum: {
      totalTokens: true,
      estimatedCost: true,
    },
  });

  const planId = await resolveWorkspacePlan(prisma, workspaceId);
  const plan = getPlanById(planId);

  return {
    workspaceId,
    monthlyTokens: usage._sum.totalTokens ?? 0,
    monthlyCost: usage._sum.estimatedCost ?? 0,
    monthlyTokensLimit: plan.monthlyTokensLimit,
    monthlyCostLimit: plan.monthlyCostLimit,
    periodStart: start,
    periodEnd: end,
    plan: planId,
  };
}

/**
 * Check if workspace has exceeded quota.
 */
export async function checkQuota(
  prisma: PrismaClient,
  workspaceId: string,
  estimatedTokens: number,
  estimatedCost: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const quota = await getWorkspaceUsage(prisma, workspaceId);

  if (quota.monthlyTokens + estimatedTokens > quota.monthlyTokensLimit) {
    return {
      allowed: false,
      reason: `Monthly token limit exceeded (${quota.monthlyTokens}/${quota.monthlyTokensLimit})`,
    };
  }

  if (quota.monthlyCost + estimatedCost > quota.monthlyCostLimit) {
    return {
      allowed: false,
      reason: `Monthly cost limit exceeded ($${quota.monthlyCost.toFixed(2)}/$${quota.monthlyCostLimit})`,
    };
  }

  return { allowed: true };
}

/**
 * Enforce quota - throws if exceeded.
 */
export async function enforceQuota(
  prisma: PrismaClient,
  workspaceId: string,
  estimatedTokens: number,
  estimatedCost: number,
): Promise<void> {
  const result = await checkQuota(prisma, workspaceId, estimatedTokens, estimatedCost);
  if (!result.allowed) {
    throw errors.forbidden(result.reason);
  }
}
