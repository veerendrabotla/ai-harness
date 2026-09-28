/**
 * GitLab Inbound Webhook Handler.
 * Handles push events from GitLab repositories.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { timingSafeEqual } from "node:crypto";

const SYSTEM_USER_EMAIL = "system@aiharness.dev";

export interface GitLabPushPayload {
  object_kind: string;
  ref: string;
  checkout_sha: string;
  user_name: string;
  user_email: string;
  project: {
    id: number;
    name: string;
    url: string;
    default_branch: string;
  };
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: { name: string; email: string };
  }>;
  total_commits_count: number;
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
 * Verify GitLab webhook token.
 */
export function verifyGitLabToken(token: string, secret: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Handle GitLab push webhook.
 */
export async function handleGitLabWebhook(
  app: FastifyInstance,
  payload: GitLabPushPayload,
  projectId: string,
): Promise<void> {
  const project = await app.prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true, defaultBranch: true, deploymentProtection: true, webhookSecret: true },
  });
  if (!project) throw errors.notFound("Project");

  const branch = payload.ref.replace("refs/heads/", "");
  if (project.defaultBranch && branch !== project.defaultBranch) return;

  const systemUserId = await getSystemUserId(app.prisma);
  const commitMsg = payload.commits[0]?.message ?? "GitLab push";

  const config = project.deploymentProtection as Record<string, unknown> | null;
  if (config?.requireApproval) {
    const deployment = await app.prisma.deployment.create({
      data: {
        projectId,
        createdBy: systemUserId,
        environment: "production",
        status: "QUEUED",
        sourceBranch: branch,
        sourceRevision: payload.checkout_sha,
        metadata: {
          webhook: true,
          provider: "gitlab",
          pusher: payload.user_name,
          commits: payload.total_commits_count,
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
          message: `A GitLab push on branch "${branch}" requires manual approval.`,
          metadata: { deploymentId: deployment.id, projectId, branch, pusher: payload.user_name, commitMessage: commitMsg },
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
      sourceRevision: payload.checkout_sha,
      metadata: { webhook: true, provider: "gitlab", pusher: payload.user_name, commits: payload.total_commits_count, commitMessage: commitMsg },
    },
  });
}

/**
 * Register GitLab webhook route.
 */
export function registerGitLabWebhookRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/webhook/gitlab", {
    schema: {
      tags: ["git", "gitlab"],
      summary: "GitLab webhook endpoint",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const token = req.headers["x-gitlab-token"] as string | undefined;

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { webhookSecret: true },
    });

    const webhookSecret = project?.webhookSecret || process.env.GITLAB_WEBHOOK_SECRET;
    if (webhookSecret && token) {
      if (!verifyGitLabToken(token, webhookSecret)) {
        reply.code(401);
        throw new Error("Invalid GitLab webhook token");
      }
    }

    const payload = req.body as GitLabPushPayload;
    if (payload.object_kind === "push") {
      await handleGitLabWebhook(app, payload, projectId);
    }

    return reply.code(200).send({ received: true });
  });
}
