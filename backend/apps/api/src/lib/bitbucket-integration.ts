/**
 * Bitbucket Inbound Webhook Handler.
 * Handles push events from Bitbucket repositories.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { createHmac, timingSafeEqual } from "node:crypto";

const SYSTEM_USER_EMAIL = "system@aiharness.dev";

export interface BitbucketPushPayload {
  push: {
    changes: Array<{
      new: { name: string; target: { hash: string; message: string } };
      old: { name: string };
    }>;
  };
  repository: {
    name: string;
    url: string;
  };
  actor: {
    display_name: string;
    uuid: string;
  };
}

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
 * Verify Bitbucket webhook signature (HMAC-SHA256).
 */
export function verifyBitbucketSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");
  const sig = signature.replace("sha256=", "");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSignature, "hex"));
  } catch {
    return false;
  }
}

/**
 * Handle Bitbucket push webhook.
 */
export async function handleBitbucketWebhook(
  app: FastifyInstance,
  payload: BitbucketPushPayload,
  projectId: string,
): Promise<void> {
  const project = await app.prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true, defaultBranch: true, deploymentProtection: true, webhookSecret: true },
  });
  if (!project) throw errors.notFound("Project");

  const change = payload.push?.changes?.[0];
  if (!change) return;

  const branch = change.new.name;
  if (project.defaultBranch && branch !== project.defaultBranch) return;

  const systemUserId = await getSystemUserId(app.prisma);
  const commitMsg = change.new.target.message ?? "Bitbucket push";

  const config = project.deploymentProtection as Record<string, unknown> | null;
  if (config?.requireApproval) {
    const deployment = await app.prisma.deployment.create({
      data: {
        projectId,
        createdBy: systemUserId,
        environment: "production",
        status: "QUEUED",
        sourceBranch: branch,
        sourceRevision: change.new.target.hash,
        metadata: {
          webhook: true,
          provider: "bitbucket",
          pusher: payload.actor.display_name,
          commitMessage: commitMsg,
          requiresApproval: true,
          approvalStatus: "PENDING",
        },
      },
    });

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
          message: `A Bitbucket push on branch "${branch}" requires manual approval.`,
          metadata: { deploymentId: deployment.id, projectId, branch, pusher: payload.actor.display_name, commitMessage: commitMsg },
        },
      });
    }
    return;
  }

  await app.prisma.deployment.create({
    data: {
      projectId,
      createdBy: systemUserId,
      environment: "production",
      status: "QUEUED",
      sourceBranch: branch,
      sourceRevision: change.new.target.hash,
      metadata: { webhook: true, provider: "bitbucket", pusher: payload.actor.display_name, commitMessage: commitMsg },
    },
  });
}

/**
 * Register Bitbucket webhook route.
 */
export function registerBitbucketWebhookRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/webhook/bitbucket", {
    schema: {
      tags: ["git", "bitbucket"],
      summary: "Bitbucket webhook endpoint",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const payloadStr = JSON.stringify(req.body);

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { webhookSecret: true },
    });

    const webhookSecret = project?.webhookSecret || process.env.BITBUCKET_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      if (!verifyBitbucketSignature(payloadStr, signature, webhookSecret)) {
        reply.code(401);
        throw new Error("Invalid Bitbucket webhook signature");
      }
    }

    const payload = req.body as BitbucketPushPayload;
    if (payload.push?.changes?.length > 0) {
      await handleBitbucketWebhook(app, payload, projectId);
    }

    return reply.code(200).send({ received: true });
  });
}
