/**
 * Deployment Provider API Routes.
 * Provider management and deployment operations.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import {
  InMemoryDeploymentProviderRegistry,
  SelfHostedDeploymentProvider,
  VercelDeploymentProvider,
  CloudflareDeploymentProvider,
  RailwayDeploymentProvider,
  InMemoryCredentialManager,
} from "@ai-harness/deployment-provider";

// Singleton instances
const registry = new InMemoryDeploymentProviderRegistry();
const credentialManager = new InMemoryCredentialManager();

// Register all providers
registry.register(new SelfHostedDeploymentProvider());
registry.register(new VercelDeploymentProvider());
registry.register(new CloudflareDeploymentProvider());
registry.register(new RailwayDeploymentProvider());

async function requireProjectAccess(request: FastifyRequest, projectId: string, app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
  if (!project) throw errors.notFound("Project");
  await app.requireWorkspaceRole(request, project.workspaceId, "MEMBER");
  return project;
}

export async function deploymentProviderRoutes(app: FastifyInstance) {
  /**
   * List available providers.
   */
  app.get("/v1/deployment-providers", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "List available deployment providers",
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    const providers = registry.getAll().map((p) => ({
      type: p.type,
      capabilities: p.getCapabilities(),
    }));

    return ok(reply, { providers });
  });

  /**
   * Get provider capabilities.
   */
  app.get<{ Params: { providerType: string } }>(
    "/v1/deployment-providers/:providerType",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["deployment-providers"],
        summary: "Get provider capabilities",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["providerType"],
          properties: { providerType: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const provider = registry.get(request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
      if (!provider) {
        return reply.status(404).send({ error: "Provider not found" });
      }

      return ok(reply, {
        type: provider.type,
        capabilities: provider.getCapabilities(),
      });
    },
  );

  /**
   * Validate credentials for a provider.
   */
  app.post<{
    Params: { providerType: string };
    Body: { credentials: Record<string, string>; projectId?: string };
  }>("/v1/deployment-providers/:providerType/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "Validate credentials for a deployment provider",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["providerType"],
        properties: { providerType: { type: "string" } },
      },
    },
  }, async (request, reply) => {
    const provider = registry.get(request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
    if (!provider) {
      return reply.status(404).send({ error: "Provider not found" });
    }

    const valid = await provider.validateCredentials(request.body.credentials);

    return ok(reply, { valid });
  });

  /**
   * Prepare a deployment.
   */
  app.post<{
    Body: {
      providerType: string;
      projectId: string;
      source: { type: "git" | "upload" | "url"; repository?: string; branch?: string; commitSha?: string };
      buildCommand?: string;
      outputDirectory?: string;
      framework?: string;
      environmentVariables?: Record<string, string>;
    };
  }>("/v1/deployments/prepare", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "Prepare a deployment configuration",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { providerType, projectId, ...config } = request.body;
    await requireProjectAccess(request, projectId, app);
    const userId = (request.user as { sub: string }).sub;

    const provider = registry.get(providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
    if (!provider) {
      return reply.status(404).send({ error: "Provider not found" });
    }

    const result = await provider.prepare({ projectId, userId, ...config });

    return ok(reply, result);
  });

  /**
   * Start a deployment.
   */
  app.post<{
    Body: {
      providerType: string;
      projectId: string;
      source: { type: "git" | "upload" | "url"; repository?: string; branch?: string; commitSha?: string };
      buildCommand?: string;
      outputDirectory?: string;
      framework?: string;
      environmentVariables?: Record<string, string>;
    };
  }>("/v1/deployments/start", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "Start a new deployment",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { providerType, projectId, ...config } = request.body;
    await requireProjectAccess(request, projectId, app);
    const userId = (request.user as { sub: string }).sub;

    const provider = registry.get(providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
    if (!provider) {
      return reply.status(404).send({ error: "Provider not found" });
    }

    // Get credentials from the credential manager
    const credentials: Record<string, string> = {};
    if (providerType !== "self_hosted") {
      const storedCreds = await credentialManager.getByProjectAndProvider(projectId, providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
      for (const cred of storedCreds) {
        credentials[`${cred.providerType}_token`] = cred.encryptedValue;
      }
    }

    const deployment = await provider.deploy({ projectId, userId, ...config }, credentials);

    return ok(reply, deployment, 201);
  });

  /**
   * Get deployment status.
   */
  app.get<{
    Params: { providerType: string; deploymentId: string };
    Querystring: { projectId: string };
  }>("/v1/deployments/:providerType/:deploymentId/status", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "Get deployment status",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["providerType", "deploymentId"],
        properties: {
          providerType: { type: "string" },
          deploymentId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const provider = registry.get(request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
    if (!provider) {
      return reply.status(404).send({ error: "Provider not found" });
    }

    const { projectId } = request.query;
    await requireProjectAccess(request, projectId, app);

    const credentials: Record<string, string> = {};
    if (request.params.providerType !== "self_hosted") {
      const storedCreds = await credentialManager.getByProjectAndProvider(projectId, request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
      for (const cred of storedCreds) {
        credentials[`${cred.providerType}_token`] = cred.encryptedValue;
      }
    }

    const status = await provider.getStatus(request.params.deploymentId, credentials);

    return ok(reply, status);
  });

  /**
   * Cancel a deployment.
   */
  app.post<{
    Params: { providerType: string; deploymentId: string };
    Querystring: { projectId: string };
  }>("/v1/deployments/:providerType/:deploymentId/cancel", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "Cancel a deployment",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["providerType", "deploymentId"],
        properties: {
          providerType: { type: "string" },
          deploymentId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const provider = registry.get(request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
    if (!provider) {
      return reply.status(404).send({ error: "Provider not found" });
    }

    const { projectId } = request.query;
    await requireProjectAccess(request, projectId, app);

    const credentials: Record<string, string> = {};
    if (request.params.providerType !== "self_hosted") {
      const storedCreds = await credentialManager.getByProjectAndProvider(projectId, request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
      for (const cred of storedCreds) {
        credentials[`${cred.providerType}_token`] = cred.encryptedValue;
      }
    }

    const cancelled = await provider.cancel(request.params.deploymentId, credentials);

    return ok(reply, { cancelled });
  });

  /**
   * Rollback a deployment.
   */
  app.post<{
    Params: { providerType: string; deploymentId: string };
    Querystring: { projectId: string };
  }>("/v1/deployments/:providerType/:deploymentId/rollback", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "Rollback a deployment",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["providerType", "deploymentId"],
        properties: {
          providerType: { type: "string" },
          deploymentId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const provider = registry.get(request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
    if (!provider) {
      return reply.status(404).send({ error: "Provider not found" });
    }

    const { projectId } = request.query;
    await requireProjectAccess(request, projectId, app);

    const credentials: Record<string, string> = {};
    if (request.params.providerType !== "self_hosted") {
      const storedCreds = await credentialManager.getByProjectAndProvider(projectId, request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
      for (const cred of storedCreds) {
        credentials[`${cred.providerType}_token`] = cred.encryptedValue;
      }
    }

    const rolledBack = await provider.rollback(request.params.deploymentId, credentials);

    return ok(reply, rolledBack);
  });

  /**
   * Get deployment logs.
   */
  app.get<{
    Params: { providerType: string; deploymentId: string };
    Querystring: { projectId: string };
  }>("/v1/deployments/:providerType/:deploymentId/logs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deployment-providers"],
      summary: "Get deployment logs",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["providerType", "deploymentId"],
        properties: {
          providerType: { type: "string" },
          deploymentId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const provider = registry.get(request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
    if (!provider) {
      return reply.status(404).send({ error: "Provider not found" });
    }

    const { projectId } = request.query;
    await requireProjectAccess(request, projectId, app);

    const credentials: Record<string, string> = {};
    if (request.params.providerType !== "self_hosted") {
      const storedCreds = await credentialManager.getByProjectAndProvider(projectId, request.params.providerType as "vercel" | "cloudflare" | "railway" | "self_hosted");
      for (const cred of storedCreds) {
        credentials[`${cred.providerType}_token`] = cred.encryptedValue;
      }
    }

    const logs = await provider.getLogs(request.params.deploymentId, credentials);

    return ok(reply, { logs });
  });
}
