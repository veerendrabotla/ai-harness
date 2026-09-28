/**
 * Deployment Protection Service.
 * Enforces approval workflows and protection rules for deployments.
 */
import type { PrismaClient } from "@prisma/client";
import { errors } from "@ai-harness/shared";

export interface DeploymentProtectionConfig {
  requireApproval: boolean;
  allowedReviewers: string[];
  requiredApprovals: number;
  autoDeploy: boolean;
  branchRestrictions: string[];
}

const DEFAULT_PROTECTION: DeploymentProtectionConfig = {
  requireApproval: false,
  allowedReviewers: [],
  requiredApprovals: 1,
  autoDeploy: true,
  branchRestrictions: [],
};

/**
 * Get deployment protection config for a project.
 */
export async function getProtectionConfig(
  prisma: PrismaClient,
  projectId: string,
): Promise<DeploymentProtectionConfig> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { deploymentProtection: true },
  });

  if (!project?.deploymentProtection) {
    return DEFAULT_PROTECTION;
  }

  return {
    ...DEFAULT_PROTECTION,
    ...(project.deploymentProtection as Partial<DeploymentProtectionConfig>),
  };
}

/**
 * Check if deployment is allowed.
 */
export async function checkDeploymentAllowed(
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  branch: string,
): Promise<{ allowed: boolean; reason?: string; requiresApproval: boolean }> {
  const config = await getProtectionConfig(prisma, projectId);

  // Check branch restrictions
  if (config.branchRestrictions.length > 0) {
    if (!config.branchRestrictions.includes(branch)) {
      return {
        allowed: false,
        reason: `Deployment not allowed from branch: ${branch}`,
        requiresApproval: false,
      };
    }
  }

  // Check if approval is required
  if (config.requireApproval) {
    // Check if user is an allowed reviewer
    if (config.allowedReviewers.length > 0) {
      if (!config.allowedReviewers.includes(userId)) {
        return {
          allowed: false,
          reason: "User not authorized to deploy",
          requiresApproval: true,
        };
      }
    }

    return {
      allowed: true,
      requiresApproval: true,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
  };
}

/**
 * Create deployment approval request.
 */
export async function createApprovalRequest(
  prisma: PrismaClient,
  taskId: string,
  projectId: string,
  _requestedBy: string,
): Promise<string> {
  const config = await getProtectionConfig(prisma, projectId);

  if (!config.requireApproval) {
    throw errors.validation("Deployment does not require approval");
  }

  // Create approval request using existing ApprovalRequest model
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

  const approval = await prisma.approvalRequest.create({
    data: {
      taskId,
      requestedByActor: "AGENT",
      requestedScope: "TASK",
      status: "PENDING",
      expiresAt,
    },
  });

  return approval.id;
}

/**
 * Get approval request by ID.
 */
export async function getApprovalRequest(
  prisma: PrismaClient,
  approvalId: string,
): Promise<{ id: string; status: string; requiredApprovals: number } | null> {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
  });

  if (!approval) return null;

  return {
    id: approval.id,
    status: approval.status,
    requiredApprovals: 1, // Default for now
  };
}

/**
 * Approve a deployment.
 */
export async function approveDeployment(
  prisma: PrismaClient,
  approvalId: string,
  userId: string,
): Promise<boolean> {
  const approval = await getApprovalRequest(prisma, approvalId);
  if (!approval) throw errors.notFound("Approval request");
  if (approval.status !== "PENDING") throw errors.validation("Approval already processed");

  // Record approval
  await prisma.approvalRequest.update({
    where: { id: approvalId },
    data: {
      status: "APPROVED",
      decidedBy: userId,
    },
  });

  return true;
}

/**
 * Reject a deployment.
 */
export async function rejectDeployment(
  prisma: PrismaClient,
  approvalId: string,
  userId: string,
): Promise<void> {
  const approval = await getApprovalRequest(prisma, approvalId);
  if (!approval) throw errors.notFound("Approval request");
  if (approval.status !== "PENDING") throw errors.validation("Approval already processed");

  await prisma.approvalRequest.update({
    where: { id: approvalId },
    data: {
      status: "DENIED",
      decidedBy: userId,
    },
  });
}
