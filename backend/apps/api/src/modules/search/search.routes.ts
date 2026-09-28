/**
 * Search Routes.
 * Unified search across projects and tasks within a workspace.
 */
import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";

interface SearchResult {
  type: "project" | "task" | "deployment" | "knowledge";
  id: string;
  title: string;
  subtitle: string;
  matchedOn: string[];
  relevance: number;
  createdAt: string;
}

export default function registerSearchRoutes(app: FastifyInstance) {
  app.get("/v1/search", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["search"],
      summary: "Unified search across projects and tasks",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["q"],
        properties: {
          q: { type: "string", minLength: 1, maxLength: 500 },
          workspaceId: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["project", "task", "deployment", "knowledge", "all"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as {
      q: string;
      workspaceId?: string;
      type?: string;
      limit?: number;
    };
    const userId = req.user!.sub;
    const limit = query.limit ?? 20;
    const searchType = query.type ?? "all";
    const searchTerm = query.q.toLowerCase();

    // Resolve accessible workspace IDs
    const memberships = await app.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    if (workspaceIds.length === 0) {
      return ok(reply, []);
    }

    const targetWorkspaceIds = query.workspaceId
      ? workspaceIds.filter((id) => id === query.workspaceId)
      : workspaceIds;

    if (targetWorkspaceIds.length === 0) {
      return ok(reply, []);
    }

    const results: SearchResult[] = [];

    // Search projects
    if (searchType === "all" || searchType === "project") {
      const projects = await app.prisma.project.findMany({
        where: {
          workspaceId: { in: targetWorkspaceIds },
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } },
            { repositoryUrl: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: "desc" },
      });

      for (const p of projects) {
        const matchedOn: string[] = [];
        let relevance = 0;

        if (p.name.toLowerCase().includes(searchTerm)) {
          matchedOn.push("name");
          // Exact match bonus
          relevance += p.name.toLowerCase() === searchTerm ? 100 : 50;
        }
        if (p.repositoryUrl?.toLowerCase().includes(searchTerm)) {
          matchedOn.push("repositoryUrl");
          relevance += 20;
        }

        results.push({
          type: "project",
          id: p.id,
          title: p.name,
          subtitle: p.repositoryUrl ?? p.connectionType,
          matchedOn,
          relevance,
          createdAt: p.createdAt.toISOString(),
        });
      }
    }

    // Search tasks
    if (searchType === "all" || searchType === "task") {
      const tasks = await app.prisma.task.findMany({
        where: {
          workspaceId: { in: targetWorkspaceIds },
          OR: [
            { goal: { contains: searchTerm, mode: "insensitive" } },
            { constraints: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          goal: true,
          constraints: true,
          state: true,
          agentMode: true,
          createdAt: true,
        },
        take: limit,
        orderBy: { updatedAt: "desc" },
      });

      for (const t of tasks) {
        const matchedOn: string[] = [];
        let relevance = 0;

        if (t.goal.toLowerCase().includes(searchTerm)) {
          matchedOn.push("goal");
          relevance += t.goal.toLowerCase() === searchTerm ? 100 : 50;
        }
        if (t.constraints?.toLowerCase().includes(searchTerm)) {
          matchedOn.push("constraints");
          relevance += 20;
        }

        results.push({
          type: "task",
          id: t.id,
          title: t.goal.length > 120 ? t.goal.slice(0, 117) + "..." : t.goal,
          subtitle: `${t.state} · ${t.agentMode}`,
          matchedOn,
          relevance,
          createdAt: t.createdAt.toISOString(),
        });
      }
    }

    // Search deployments
    if (searchType === "all" || searchType === "deployment") {
      const projects = await app.prisma.project.findMany({
        where: { workspaceId: { in: targetWorkspaceIds } },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);

      const deployments = await app.prisma.deployment.findMany({
        where: {
          projectId: { in: projectIds },
          sourceBranch: { contains: searchTerm, mode: "insensitive" },
        },
        select: {
          id: true,
          environment: true,
          sourceBranch: true,
          status: true,
          createdAt: true,
          projectId: true,
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      // Resolve project names separately
      const projIds = [...new Set(deployments.map((d) => d.projectId))];
      const projNames = await app.prisma.project.findMany({
        where: { id: { in: projIds } },
        select: { id: true, name: true },
      });
      const nameMap = new Map(projNames.map((p) => [p.id, p.name]));

      for (const d of deployments) {
        const matchedOn: string[] = [];
        let relevance = 0;

        if (d.sourceBranch?.toLowerCase().includes(searchTerm)) {
          matchedOn.push("sourceBranch");
          relevance += 30;
        }

        results.push({
          type: "deployment",
          id: d.id,
          title: `${nameMap.get(d.projectId) ?? "Project"} — ${d.environment}`,
          subtitle: `${d.status} · ${d.sourceBranch ?? "default"}`,
          matchedOn,
          relevance,
          createdAt: d.createdAt.toISOString(),
        });
      }
    }

    // Search knowledge entries
    if (searchType === "all" || searchType === "knowledge") {
      const knowledgeResults = await app.prisma.$queryRaw`
        SELECT id, title, content, category, "createdAt"
        FROM knowledge_entries
        WHERE "workspaceId" IN (${app.prisma.$queryRaw`SELECT UNNEST(${targetWorkspaceIds}::text[])`})
          AND (LOWER(title) LIKE LOWER(${`%${searchTerm}%`}) OR LOWER(content) LIKE LOWER(${`%${searchTerm}%`}))
        ORDER BY "createdAt" DESC
        LIMIT ${limit}
      ` as Array<{ id: string; title: string; content: string; category: string; createdAt: Date }>;

      for (const k of knowledgeResults) {
        const matchedOn: string[] = [];
        let relevance = 0;

        if (k.title?.toLowerCase().includes(searchTerm)) {
          matchedOn.push("title");
          relevance += k.title.toLowerCase() === searchTerm ? 100 : 40;
        }
        if (k.content?.toLowerCase().includes(searchTerm)) {
          matchedOn.push("content");
          relevance += 15;
        }

        results.push({
          type: "knowledge",
          id: k.id,
          title: k.title,
          subtitle: k.category ?? "uncategorized",
          matchedOn,
          relevance,
          createdAt: k.createdAt.toISOString(),
        });
      }
    }

    // Sort by relevance descending, then by createdAt descending
    results.sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return ok(reply, results.slice(0, limit));
  });
}
