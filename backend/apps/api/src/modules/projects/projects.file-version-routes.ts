/**
 * File Version Routes.
 * Query file versions for a project.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

export default function registerFileVersionQueryRoutes(app: FastifyInstance) {
  /**
   * List file versions for a project.
   */
  app.get<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["file-versions"],
      summary: "List file versions for a project",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { projectId } = req.params as { projectId: string };
    const { path: filePath } = (req.query ?? {}) as { path?: string };

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const where: Record<string, unknown> = { projectId };
    if (filePath) where.path = filePath;

    const versions = await app.prisma.fileVersion.findMany({
      where,
      orderBy: [{ path: "asc" }, { version: "desc" }],
      take: 200,
    });

    return ok(reply, { versions });
  });

  /**
   * Get version history for a specific file.
   */
  app.get<{
    Params: { projectId: string };
  }>("/v1/projects/:projectId/versions/history", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["file-versions"],
      summary: "Get version history for a file path",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const userId = req.user?.sub;
    if (!userId) throw errors.unauthenticated();
    const { projectId } = req.params as { projectId: string };
    const { path: filePath } = (req.query ?? {}) as { path: string };

    if (!filePath) throw errors.validation("path query parameter is required");

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const versions = await app.prisma.fileVersion.findMany({
      where: { projectId, path: filePath },
      orderBy: { version: "desc" },
      take: 50,
    });

    return ok(reply, { versions });
  });
}
