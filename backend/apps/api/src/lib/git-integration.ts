/**
 * Git Integration Service.
 * Automatic deployment on push via webhooks.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import pino from "pino";

const log = pino({ name: "git-integration", level: "warn" });

const SYSTEM_USER_EMAIL = "system@aiharness.dev";

export interface GitWebhookPayload {
  ref: string;
  repository: {
    name: string;
    clone_url: string;
  };
  pusher: {
    name: string;
    email: string;
  };
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
  }>;
}

/**
 * Get or create the system user for automated deployments.
 */
async function getSystemUserId(prisma: FastifyInstance["prisma"]): Promise<string> {
  const systemUser = await prisma.user.findUnique({
    where: { email: SYSTEM_USER_EMAIL },
    select: { id: true },
  });
  if (systemUser) return systemUser.id;

  const created = await prisma.user.create({
    data: {
      email: SYSTEM_USER_EMAIL,
      displayName: "AI Harness System",
      passwordHash: "system",
      platformRole: "PLATFORM_ADMIN",
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Verify webhook signature.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  
  const sig = signature.replace("sha256=", "");
  
  try {
    return timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch (err) {
    log.error({ err }, "[Git] Signature verification failed:");
    return false;
  }
}

/**
 * Handle GitHub webhook.
 */
export async function handleGitHubWebhook(
  app: FastifyInstance,
  payload: GitWebhookPayload,
  projectId: string,
): Promise<void> {
  const project = await app.prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      workspaceId: true,
      defaultBranch: true,
      deploymentProtection: true,
      webhookSecret: true,
    },
  });

  if (!project) throw errors.notFound("Project");

  // Check if push is to default branch
  const branch = payload.ref.replace("refs/heads/", "");
  if (project.defaultBranch && branch !== project.defaultBranch) {
    return; // Not the default branch, skip
  }

  const systemUserId = await getSystemUserId(app.prisma);
  const commitMsg = payload.commits[0]?.message ?? "Webhook push";

  // Check deployment protection
  const config = project.deploymentProtection as Record<string, unknown> | null;
  if (config?.requireApproval) {
    const deployment = await app.prisma.deployment.create({
      data: {
        projectId,
        createdBy: systemUserId,
        environment: "production",
        status: "QUEUED",
        sourceBranch: branch,
        sourceRevision: payload.commits[0]?.id,
        metadata: {
          webhook: true,
          pusher: payload.pusher.name,
          commits: payload.commits.length,
          commitMessage: commitMsg,
          requiresApproval: true,
          approvalStatus: "PENDING",
        },
      },
    });

    // Notify workspace members about pending approval
    const members = await app.prisma.workspaceMember.findMany({
      where: { workspaceId: project.workspaceId },
      select: { userId: true },
    });

    for (const member of members) {
      await app.prisma.notification.create({
        data: {
          userId: member.userId,
          type: "DEPLOYMENT_APPROVAL",
          title: "Deployment Requires Approval",
          message: `A deployment on branch "${branch}" requires manual approval.`,
          metadata: {
            deploymentId: deployment.id,
            projectId,
            branch,
            pusher: payload.pusher.name,
            commitMessage: commitMsg,
          },
        },
      });
    }

    app.log.info(
      { projectId, branch, deploymentId: deployment.id },
      "Deployment requires approval, notifications sent",
    );
    return;
  }

  // Trigger deployment
  await app.prisma.deployment.create({
    data: {
      projectId,
      createdBy: systemUserId,
      environment: "production",
      status: "QUEUED",
      sourceBranch: branch,
      sourceRevision: payload.commits[0]?.id,
      metadata: {
        webhook: true,
        pusher: payload.pusher.name,
        commits: payload.commits.length,
        commitMessage: commitMsg,
      },
    },
  });

  app.log.info({ projectId, branch }, "Deployment triggered by webhook");
}

/**
 * Register Git webhook routes for a project.
 */
export function registerGitWebhookRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/webhook", {
    schema: {
      tags: ["git"],
      summary: "Git webhook endpoint",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const payload = JSON.stringify(req.body);

    // Verify webhook signature from per-project config
    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { webhookSecret: true },
    });

    const webhookSecret = project?.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      if (!verifyWebhookSignature(payload, signature, webhookSecret)) {
        reply.code(401);
        throw new Error("Invalid webhook signature");
      }
    }

    const gitPayload = req.body as GitWebhookPayload;
    await handleGitHubWebhook(app, gitPayload, projectId);

    return reply.code(200).send({ received: true });
  });
}
