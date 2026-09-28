/**
 * Deployment API Routes — REAL infrastructure.
 * Uses DeploymentEngine with Prisma persistence and Bridge Gateway execution.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { errors, AppError } from "@ai-harness/shared";
import { DeploymentEngine } from "@ai-harness/deployment-engine";
import {
  InMemoryDeploymentProviderRegistry,
  SelfHostedDeploymentProvider,
  VercelDeploymentProvider,
  CloudflareDeploymentProvider,
  RailwayDeploymentProvider,
  DefaultDeploymentProviderFactory,
} from "@ai-harness/deployment-provider";
import { ok, reqParam } from "../../lib/http.js";
import { checkDeploymentAllowed } from "../../lib/deployment-protection.js";
import { auditFromRequest } from "../../lib/audit.js";

const deploySchema = z.object({
  buildCommand: z.string().max(2048).default("npm run build"),
  environment: z.enum(["production", "preview", "staging"]).default("production"),
  outputDir: z.string().max(512).optional(),
  taskId: z.string().uuid().optional(),
  checkpointId: z.string().uuid().optional(),
});

// Singleton provider registry (vercel, railway, cloudflare, self_hosted) shared across requests
const providerRegistry = new InMemoryDeploymentProviderRegistry();
providerRegistry.register(new SelfHostedDeploymentProvider());
providerRegistry.register(new VercelDeploymentProvider());
providerRegistry.register(new CloudflareDeploymentProvider());
providerRegistry.register(new RailwayDeploymentProvider());

/**
 * Prisma-backed credential manager for DeploymentEngine provider resolution.
 * Reads from DeploymentSecret (encrypted at rest) – satisfies DefaultDeploymentProviderFactory contract.
 */
class PrismaCredentialManager {
  constructor(private readonly prisma: import("@prisma/client").PrismaClient) {}
  async getByProjectAndProvider(projectId: string, providerType: string): Promise<unknown[]> {
    const secrets = await (this.prisma as unknown as { deploymentSecret: { findMany: (a: unknown) => Promise<Array<{ id: string; providerType: string; name: string; encryptedValue: string; metadata: unknown; createdAt: Date; updatedAt: Date }>> } }).deploymentSecret.findMany({
      where: { projectId, providerType: providerType as never },
    });
    return secrets.map((s) => ({
      id: s.id,
      projectId,
      providerType: s.providerType,
      name: s.name,
      encryptedValue: s.encryptedValue,
      metadata: s.metadata,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }
  async getByProject(projectId: string): Promise<unknown[]> {
    const secrets = await (this.prisma as unknown as { deploymentSecret: { findMany: (a: unknown) => Promise<Array<{ id: string; providerType: string; name: string; encryptedValue: string; metadata: unknown; createdAt: Date; updatedAt: Date }>> } }).deploymentSecret.findMany({
      where: { projectId },
    });
    return secrets.map((s) => ({
      id: s.id,
      projectId,
      providerType: s.providerType,
      name: s.name,
      encryptedValue: s.encryptedValue,
      metadata: s.metadata,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }
  async get(): Promise<null> { return null; }
  async store(): Promise<never> { throw new Error("not implemented"); }
  async update(): Promise<never> { throw new Error("not implemented"); }
  async delete(): Promise<boolean> { return false; }
  async markUsed(): Promise<void> {}
}

function engine(app: FastifyInstance): DeploymentEngine {
  const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;
  const credentialManager = new PrismaCredentialManager(prisma) as unknown as import("@ai-harness/deployment-provider").CredentialManager;
  const factory = new DefaultDeploymentProviderFactory(providerRegistry, credentialManager);
  return new DeploymentEngine(prisma, (event, data) => {
    if (event === "deployment:status" && data && typeof data === "object" && "deploymentId" in data) {
      // Fan out over Redis so every API replica emits WS events and exactly one
      // delivers notifications (dedupe in notification-dispatcher.ts).
      app.publishDeploymentStatus?.(data);
    }
  }, factory as unknown as import("@ai-harness/deployment-engine").EngineProviderFactory);
}

export function registerDeployRoutes(app: FastifyInstance): void {
  // ── Start deployment ──────────────────────────────────────
  app.post<{
    Params: { projectId: string };
    Body: z.infer<typeof deploySchema>;
  }>("/v1/projects/:projectId/deploy", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["deploy"],
      summary: "Start a deployment",
      params: {
        type: "object",
        required: ["projectId"],
        properties: { projectId: { type: "string" } },
      },
    },
  }, async (request, reply) => {
    try {
      const projectId = reqParam(request, "projectId");
      const input = deploySchema.parse(request.body);
      const userId = (request.user as { sub: string }).sub;
      const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;

      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
      if (!project) throw errors.notFound("Project");
      await app.requireWorkspaceRole(request, project.workspaceId, "MEMBER");

      // Check deployment protection rules
      const protection = await checkDeploymentAllowed(prisma, projectId, userId, "main");
      if (!protection.allowed) {
        throw errors.forbidden(protection.reason);
      }

      const eng = engine(app);
      const result = await eng.startDeployment({
        projectId,
        userId,
        taskId: input.taskId,
        checkpointId: input.checkpointId,
        buildCommand: input.buildCommand,
        environment: input.environment,
        outputDir: input.outputDir,
      });

      await auditFromRequest(prisma, request, "DEPLOYMENT_STARTED", "DEPLOYMENT", result.deploymentId, project.workspaceId, {
        projectId,
        environment: input.environment,
      });

      return ok(reply, {
        deploymentId: result.deploymentId,
        status: result.status,
      }, 201);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Get deployment status ─────────────────────────────────
  app.get<{
    Params: { projectId: string; deploymentId: string };
  }>("/v1/projects/:projectId/deployments/:deploymentId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deploy"],
      summary: "Get deployment status with logs",
    },
  }, async (request, reply) => {
    const deploymentId = request.params.deploymentId;
    const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;

    const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw errors.notFound("Deployment");

    const project = await prisma.project.findUnique({ where: { id: deployment.projectId }, select: { workspaceId: true } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(request, project.workspaceId, "VIEWER");

    return ok(reply, {
      id: deployment.id,
      projectId: deployment.projectId,
      taskId: deployment.taskId,
      checkpointId: deployment.checkpointId,
      status: deployment.status,
      environment: deployment.environment,
      buildCommand: deployment.buildCommand,
      deploymentUrl: deployment.deploymentUrl,
      previewUrl: deployment.previewUrl,
      buildLogs: deployment.buildLogs,
      runtimeLogs: deployment.runtimeLogs,
      failureReason: deployment.failureReason,
      sourceRevision: deployment.sourceRevision,
      sourceBranch: deployment.sourceBranch,
      startedAt: deployment.startedAt?.toISOString() ?? null,
      buildCompletedAt: deployment.buildCompletedAt?.toISOString() ?? null,
      deployedAt: deployment.deployedAt?.toISOString() ?? null,
      completedAt: deployment.completedAt?.toISOString() ?? null,
      createdAt: deployment.createdAt.toISOString(),
    });
  });

  // ── List deployments ──────────────────────────────────────
  app.get<{
    Params: { projectId: string };
    Querystring: { status?: string; limit?: string };
  }>("/v1/projects/:projectId/deployments", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deploy"],
      summary: "List deployments for a project",
    },
  }, async (request, reply) => {
    const projectId = request.params.projectId;
    const limit = Math.min(Number(request.query.limit ?? "20"), 100);
    const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(request, project.workspaceId, "VIEWER");

    const where: Record<string, unknown> = { projectId };
    if (request.query.status) {
      where.status = request.query.status;
    }

    const deployments = await prisma.deployment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        projectId: true,
        taskId: true,
        checkpointId: true,
        status: true,
        environment: true,
        deploymentUrl: true,
        failureReason: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return ok(reply, deployments.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
      completedAt: d.completedAt?.toISOString() ?? null,
    })));
  });

  // ── Get deployment logs ───────────────────────────────────
  app.get<{
    Params: { projectId: string; deploymentId: string };
    Querystring: { stream?: string; offset?: string };
  }>("/v1/projects/:projectId/deployments/:deploymentId/logs", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["deploy"],
      summary: "Get deployment build/runtime logs",
    },
  }, async (request, reply) => {
    const deploymentId = request.params.deploymentId;
    const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;

    const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw errors.notFound("Deployment");

    const project = await prisma.project.findUnique({ where: { id: deployment.projectId }, select: { workspaceId: true } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(request, project.workspaceId, "VIEWER");

    const stream = request.query.stream ?? "build";
    const logs = stream === "runtime" ? deployment.runtimeLogs : deployment.buildLogs;

    return ok(reply, {
      deploymentId,
      stream,
      logs: logs ?? "",
      totalLines: (logs ?? "").split("\n").filter(Boolean).length,
    });
  });

  // ── Cancel deployment ─────────────────────────────────────
  app.post<{
    Params: { projectId: string; deploymentId: string };
  }>("/v1/projects/:projectId/deployments/:deploymentId/cancel", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["deploy"],
      summary: "Cancel an active deployment",
    },
  }, async (request, reply) => {
    try {
      const deploymentId = request.params.deploymentId;
      const userId = (request.user as { sub: string }).sub;
      const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;

      const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId }, select: { projectId: true } });
      if (!deployment) throw errors.notFound("Deployment");
      const project = await prisma.project.findUnique({ where: { id: deployment.projectId }, select: { workspaceId: true } });
      if (!project) throw errors.notFound("Project");
      await app.requireWorkspaceRole(request, project.workspaceId, "MEMBER");

      const eng = engine(app);
      await eng.cancel(deploymentId, userId);

      return ok(reply, { success: true, message: "Deployment cancelled" });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });

  // ── Rollback to previous deployment ───────────────────────
  app.post<{
    Params: { projectId: string; deploymentId: string };
  }>("/v1/projects/:projectId/deployments/:deploymentId/rollback", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["deploy"],
      summary: "Rollback to a previous deployment",
    },
  }, async (request, reply) => {
    try {
      const deploymentId = request.params.deploymentId;
      const userId = (request.user as { sub: string }).sub;
      const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;

      const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId }, select: { projectId: true } });
      if (!deployment) throw errors.notFound("Deployment");
      const project = await prisma.project.findUnique({ where: { id: deployment.projectId }, select: { workspaceId: true } });
      if (!project) throw errors.notFound("Project");
      await app.requireWorkspaceRole(request, project.workspaceId, "MEMBER");

      const eng = engine(app);
      const result = await eng.rollback(deploymentId, userId);

      return ok(reply, {
        deploymentId: result.deploymentId,
        status: result.status,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof ZodError) throw err;
      throw errors.internal(String(err));
    }
  });
}
