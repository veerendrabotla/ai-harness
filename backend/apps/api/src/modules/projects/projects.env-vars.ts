/**
 * Deployment Environment Variables Routes.
 * Manage environment variables for deployments.
 */
import type { FastifyInstance } from "fastify";
import { errors, encryptSecret, decryptSecret, getEnv } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerEnvVarRoutes(app: FastifyInstance) {
  /**
   * List environment variables for a project.
   */
  app.get<{
    Params: { projectId: string };
    Querystring: { environment?: string };
  }>("/v1/projects/:projectId/env-vars", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["env-vars"],
      summary: "List environment variables",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const environment = (req.query as { environment?: string }).environment ?? "production";

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const envVars = await app.prisma.deploymentEnvVar.findMany({
      where: { projectId, environment },
      select: {
        id: true,
        key: true,
        isSecret: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { key: "asc" },
    });

    return ok(reply, envVars);
  });

  /**
   * Set an environment variable.
   */
  app.post<{
    Params: { projectId: string };
    Body: { key: string; value: string; environment?: string; isSecret?: boolean };
  }>("/v1/projects/:projectId/env-vars", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["env-vars"],
      summary: "Set an environment variable",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["key", "value"],
        properties: {
          key: { type: "string", maxLength: 255 },
          value: { type: "string", maxLength: 10000 },
          environment: { type: "string", default: "production" },
          isSecret: { type: "boolean", default: false },
        },
      },
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const { key, value, environment = "production", isSecret = false } = req.body as {
      key: string;
      value: string;
      environment?: string;
      isSecret?: boolean;
    };

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const encKey = getEnv().ENCRYPTION_KEY;
    const encryptedValue = encryptSecret(value, encKey).toString("base64");

    const envVar = await app.prisma.deploymentEnvVar.upsert({
      where: {
        projectId_environment_key: { projectId, environment, key },
      },
      update: { encryptedValue, isSecret },
      create: { projectId, environment, key, encryptedValue, isSecret },
    });

    await auditFromRequest(app.prisma, req, "PROJECT_UPDATED", "PROJECT", projectId, project.workspaceId, {
      action: "ENV_VAR_SET",
      key,
      environment,
      isSecret,
    });

    return ok(reply, {
      id: envVar.id,
      key: envVar.key,
      isSecret: envVar.isSecret,
      createdAt: envVar.createdAt,
    }, 201);
  });

  /**
   * Delete an environment variable.
   */
  app.delete<{
    Params: { projectId: string; envVarId: string };
  }>("/v1/projects/:projectId/env-vars/:envVarId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["env-vars"],
      summary: "Delete an environment variable",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const envVarId = (req.params as { envVarId: string }).envVarId;

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    await app.prisma.deploymentEnvVar.delete({
      where: { id: envVarId, projectId },
    });

    await auditFromRequest(app.prisma, req, "PROJECT_UPDATED", "PROJECT", projectId, project.workspaceId, {
      action: "ENV_VAR_DELETED",
      envVarId,
    });

    return ok(reply, { success: true });
  });

  /**
   * Decrypt an environment variable value (admin only).
   */
  app.get<{
    Params: { projectId: string; envVarId: string };
  }>("/v1/projects/:projectId/env-vars/:envVarId/value", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["env-vars"],
      summary: "Decrypt environment variable value",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const envVarId = (req.params as { envVarId: string }).envVarId;

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const envVar = await app.prisma.deploymentEnvVar.findUnique({
      where: { id: envVarId, projectId },
    });
    if (!envVar) throw errors.notFound("Environment variable");

    const encKey = getEnv().ENCRYPTION_KEY;
    const value = decryptSecret(Buffer.from(envVar.encryptedValue, "base64"), encKey);

    return ok(reply, { value });
  });
}
