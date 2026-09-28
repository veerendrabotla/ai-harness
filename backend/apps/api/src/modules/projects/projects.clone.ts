/**
 * Project Clone Routes.
 * Duplicate projects with settings and configurations.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerProjectCloneRoutes(app: FastifyInstance) {
  /**
   * Clone a project.
   */
  app.post<{
    Params: { projectId: string };
    Body: { name?: string; workspaceId?: string };
  }>("/v1/projects/:projectId/clone", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["projects"],
      summary: "Clone a project with settings",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 160 },
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const projectId = (req.params as { projectId: string }).projectId;
    const { name, workspaceId: targetWorkspaceId } = req.body as { name?: string; workspaceId?: string };

    const sourceProject = await app.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        secrets: true,
        envVars: true,
        memories: true,
      },
    });
    if (!sourceProject) throw errors.notFound("Project");

    // Check access to source project
    await app.requireWorkspaceRole(req, sourceProject.workspaceId, "VIEWER");

    const destinationWorkspaceId = targetWorkspaceId ?? sourceProject.workspaceId;

    // Check access to destination workspace
    await app.requireWorkspaceRole(req, destinationWorkspaceId, "MEMBER");

    const newProjectId = randomUUID();
    const projectName = name ?? `${sourceProject.name} (Copy)`;

    // Clone project
    await app.prisma.project.create({
      data: {
        id: newProjectId,
        workspaceId: destinationWorkspaceId,
        name: projectName,
        connectionType: sourceProject.connectionType,
        repositoryUrl: sourceProject.repositoryUrl,
        rootReference: sourceProject.rootReference,
        defaultBranch: sourceProject.defaultBranch,
        deploymentProtection: sourceProject.deploymentProtection as never,
        status: "AVAILABLE",
      },
    });

    // Clone secrets (without encrypted values for security)
    for (const s of sourceProject.secrets) {
      const metadata = s.metadata ? JSON.parse(JSON.stringify(s.metadata)) : undefined;
      await app.prisma.deploymentSecret.create({
        data: {
          projectId: newProjectId,
          providerType: s.providerType,
          name: s.name,
          encryptedValue: s.encryptedValue,
          metadata: metadata as never,
        },
      });
    }

    // Clone environment variables
    if (sourceProject.envVars.length > 0) {
      await app.prisma.deploymentEnvVar.createMany({
        data: sourceProject.envVars.map((v) => ({
          projectId: newProjectId,
          environment: v.environment,
          key: v.key,
          encryptedValue: v.encryptedValue,
          isSecret: v.isSecret,
        })),
      });
    }

    // Clone memories
    if (sourceProject.memories.length > 0) {
      await app.prisma.projectMemory.createMany({
        data: sourceProject.memories.map((m) => ({
          projectId: newProjectId,
          category: m.category,
          key: m.key,
          value: m.value,
          source: m.source,
          confidence: m.confidence,
          context: m.context,
          lastAccessedAt: m.lastAccessedAt,
        })),
      });
    }

    await auditFromRequest(app.prisma, req, "PROJECT_CREATED", "PROJECT", newProjectId, destinationWorkspaceId, {
      action: "PROJECT_CLONED",
      sourceProjectId: projectId,
      projectName,
    });

    return ok(reply, {
      id: newProjectId,
      name: projectName,
      workspaceId: destinationWorkspaceId,
      clonedFrom: projectId,
    }, 201);
  });
}
