/**
 * Deployment Comment Routes.
 * Add comments to deployments for team collaboration.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

export default function registerDeploymentCommentRoutes(app: FastifyInstance) {
  /**
   * List comments for a deployment.
   */
  app.get<{
    Params: { deploymentId: string };
  }>("/v1/deployments/:deploymentId/comments", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployments", "comments"],
      summary: "List deployment comments",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const deploymentId = (req.params as { deploymentId: string }).deploymentId;

    const deployment = await app.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { id: true, projectId: true },
    });
    if (!deployment) throw errors.notFound("Deployment");

    const project = await app.prisma.project.findUnique({
      where: { id: deployment.projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const comments = await app.prisma.deploymentComment.findMany({
      where: { deploymentId },
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return ok(reply, comments);
  });

  /**
   * Add a comment to a deployment.
   */
  app.post<{
    Params: { deploymentId: string };
    Body: { content: string };
  }>("/v1/deployments/:deploymentId/comments", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployments", "comments"],
      summary: "Add a deployment comment",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", minLength: 1, maxLength: 5000 },
        },
      },
    },
  }, async (req, reply) => {
    const deploymentId = (req.params as { deploymentId: string }).deploymentId;
    const { content } = req.body as { content: string };
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();

    // Verify deployment exists
    const deployment = await app.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { id: true, projectId: true },
    });
    if (!deployment) throw errors.notFound("Deployment");

    const project = await app.prisma.project.findUnique({
      where: { id: deployment.projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const comment = await app.prisma.deploymentComment.create({
      data: {
        deploymentId,
        userId,
        content,
      },
      include: {
        user: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
    });

    // Send in-app notification to deployment creator
    try {
      const deployment = await app.prisma.deployment.findUnique({
        where: { id: deploymentId },
        select: { createdBy: true, projectId: true },
      });
      if (deployment && deployment.createdBy !== userId) {
        await app.prisma.notification.create({
          data: {
            userId: deployment.createdBy,
            type: "comment",
            title: "New comment on deployment",
            message: `${comment.user?.displayName ?? "Someone"} commented: "${content.slice(0, 120)}"`,
            metadata: { deploymentId, projectId: deployment.projectId, commentId: comment.id },
          },
        });
      }
    } catch (err) {
      req.log.error({ err }, "[DeploymentComment] Failed to send notification:");
    }

    return ok(reply, comment, 201);
  });

  /**
   * Delete a deployment comment.
   */
  app.delete<{
    Params: { deploymentId: string; commentId: string };
  }>("/v1/deployments/:deploymentId/comments/:commentId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployments", "comments"],
      summary: "Delete a deployment comment",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const deploymentId = (req.params as { deploymentId: string }).deploymentId;
    const commentId = (req.params as { commentId: string }).commentId;
    const userId = req.user?.sub;

    // Verify deployment exists
    const deployment = await app.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { id: true, projectId: true },
    });
    if (!deployment) throw errors.notFound("Deployment");

    const project = await app.prisma.project.findUnique({
      where: { id: deployment.projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    // Verify ownership
    const comment = await app.prisma.deploymentComment.findUnique({
      where: { id: commentId, deploymentId },
    });
    if (!comment) throw errors.notFound("Comment");
    if (comment.userId !== userId) throw errors.forbidden();

    await app.prisma.deploymentComment.delete({
      where: { id: commentId },
    });

    return ok(reply, { success: true });
  });
}
