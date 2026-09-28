/**
 * Usage Tracking Middleware.
 * Records token usage for each model API call.
 */
import type { PrismaClient } from "@prisma/client";
import pino from "pino";
import { resolveModelPricing } from "@ai-harness/contracts";

const log = pino({ name: "usage-tracking", level: "warn" });

export interface UsageMetadata {
  userId: string;
  workspaceId?: string;
  taskId?: string;
  providerType: string;
  modelIdentifier: string;
  stage?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Calculate estimated cost based on model and token counts.
 * Uses the canonical pricing table in `@ai-harness/contracts`
 * (`MODEL_PRICING_PER_1K`, USD per 1K tokens); unknown models fall back to a
 * conservative default rate.
 */
function estimateCost(
  providerType: string,
  modelIdentifier: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = resolveModelPricing(modelIdentifier) ?? resolveModelPricing(`${providerType.toLowerCase()}/${modelIdentifier}`);
  if (pricing) {
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  }
  // Default rate when the model is not in the canonical table (~$2/$8 per 1M)
  return (inputTokens * 2 + outputTokens * 8) / 1_000_000;
}

/**
 * Record token usage.
 */
export async function recordUsage(
  prisma: PrismaClient,
  metadata: UsageMetadata,
  usage: TokenUsage,
): Promise<void> {
  try {
    const estimatedCost = estimateCost(
      metadata.providerType,
      metadata.modelIdentifier,
      usage.inputTokens,
      usage.outputTokens,
    );

    await prisma.usageRecord.create({
      data: {
        userId: metadata.userId,
        workspaceId: metadata.workspaceId ?? null,
        taskId: metadata.taskId ?? null,
        providerType: metadata.providerType,
        modelIdentifier: metadata.modelIdentifier,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        estimatedCost,
        stage: metadata.stage ?? null,
      },
    });
  } catch (err) {
    // Usage recording should not break the request
    log.error({ err }, "[UsageTracking] Failed to record usage:");
  }
}

/**
 * Get usage summary for a workspace.
 */
export async function getWorkspaceUsage(
  prisma: PrismaClient,
  workspaceId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  totalCalls: number;
}> {
  const where: Record<string, unknown> = { workspaceId };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, unknown>).gte = startDate;
    if (endDate) (where.createdAt as Record<string, unknown>).lte = endDate;
  }

  const summary = await prisma.usageRecord.aggregate({
    where,
    _sum: {
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      estimatedCost: true,
    },
    _count: true,
  });

  return {
    inputTokens: summary._sum.inputTokens ?? 0,
    outputTokens: summary._sum.outputTokens ?? 0,
    totalTokens: summary._sum.totalTokens ?? 0,
    estimatedCost: summary._sum.estimatedCost ?? 0,
    totalCalls: summary._count,
  };
}
