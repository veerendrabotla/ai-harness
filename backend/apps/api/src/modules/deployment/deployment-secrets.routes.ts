/**
 * Deployment Secrets API Routes.
 * Manages provider credentials for deployments.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret, errors, getEnv } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

async function requireProjectAccess(request: FastifyRequest, projectId: string, app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw errors.notFound("Project");
  await app.requireWorkspaceRole(request, project.workspaceId, "MEMBER");
  return project;
}

export async function deploymentSecretRoutes(app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;

  /**
   * List secrets for a project.
   */
  app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId/deployment-secrets", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-secrets"],
      summary: "List deployment secrets for a project",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { projectId } = request.params;
    await requireProjectAccess(request, projectId, app);

    const secrets = await prisma.deploymentSecret.findMany({
      where: { projectId },
      select: {
        id: true,
        providerType: true,
        name: true,
        metadata: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, { secrets });
  });

  /**
   * Create a deployment secret.
   */
  app.post<{
    Params: { projectId: string };
    Body: {
      providerType: string;
      name: string;
      value: string;
      metadata?: Record<string, string>;
    };
  }>("/v1/projects/:projectId/deployment-secrets", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-secrets"],
      summary: "Create a deployment secret",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { projectId } = request.params;
    await requireProjectAccess(request, projectId, app);
    const { providerType, name, value, metadata } = request.body;

    const env = getEnv();
    const encryptedBuffer = encryptSecret(value, env.ENCRYPTION_KEY);
    const encryptedValue = encryptedBuffer.toString("base64");

    const secret = await prisma.deploymentSecret.create({
      data: {
        id: randomUUID(),
        projectId,
        providerType: providerType as "vercel" | "cloudflare" | "railway" | "self_hosted" | "netlify" | "render",
        name,
        encryptedValue,
        metadata: metadata ?? {},
      },
    });

    return ok(reply, {
      id: secret.id,
      providerType: secret.providerType,
      name: secret.name,
      metadata: secret.metadata,
      createdAt: secret.createdAt,
    }, 201);
  });

  /**
   * Delete a deployment secret.
   */
  app.delete<{
    Params: { projectId: string; secretId: string };
  }>("/v1/projects/:projectId/deployment-secrets/:secretId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-secrets"],
      summary: "Delete a deployment secret",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { projectId, secretId } = request.params;
    await requireProjectAccess(request, projectId, app);

    const secret = await prisma.deploymentSecret.findFirst({
      where: { id: secretId, projectId },
    });

    if (!secret) throw errors.notFound("Deployment secret");

    await prisma.deploymentSecret.delete({ where: { id: secretId } });

    return reply.status(204).send();
  });

  /**
   * Get decrypted secrets for a provider (internal use).
   */
  app.get<{
    Params: { projectId: string };
    Querystring: { providerType: string };
  }>("/v1/projects/:projectId/deployment-secrets/decrypt", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-secrets"],
      summary: "Get decrypted secrets for a provider",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { projectId } = request.params;
    await requireProjectAccess(request, projectId, app);
    const { providerType } = request.query;

    const secrets = await prisma.deploymentSecret.findMany({
      where: { projectId, providerType: providerType as "vercel" | "cloudflare" | "railway" | "self_hosted" | "netlify" | "render" },
    });

    const env = getEnv();
    const decrypted: Record<string, string> = {};
    for (const secret of secrets) {
      const payload = Buffer.from(secret.encryptedValue, "base64");
      decrypted[secret.name] = decryptSecret(payload, env.ENCRYPTION_KEY);

      await prisma.deploymentSecret.update({
        where: { id: secret.id },
        data: { lastUsedAt: new Date() },
      });
    }

    return ok(reply, { credentials: decrypted });
  });
}
