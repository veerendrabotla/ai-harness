import { PrismaClient } from "@prisma/client";
import { ensureEnvLoaded } from "@ai-harness/shared";

ensureEnvLoaded();

declare global {
   
  var __aiHarnessPrisma: PrismaClient | undefined;
}

/**
 * Tenant-scoped models — every query on these MUST include a workspaceId filter.
 * In non-test envs, queries without workspaceId on these models emit a warning
 * so cross-tenant access bugs surface immediately during development/review.
 * Full PG RLS (ALTER TABLE ... ENABLE ROW LEVEL SECURITY) is the next hardening
 * step; this middleware is the application-layer defense-in-depth.
 */
const TENANT_MODELS = new Set([
  "task",
  "taskRun",
  "taskPlan",
  "taskEvent",
  "toolCall",
  "approvalRequest",
  "project",
  "fileVersion",
  "projectMemory",
  "deployment",
  "knowledgeEntry",
  "mcpServer",
  "webContainerSession",
  "modelRoute",
]);

function createClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  // Tenant-isolation guard — warn on unscoped reads in dev/test so bugs are caught early.
  // Uses $use middleware (Prisma 5) which intercepts every query.
  base.$use(async (params, next) => {
    const model = params.model ? params.model.charAt(0).toLowerCase() + params.model.slice(1) : undefined;
    const readActions = new Set(["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"]);
    if (
      model &&
      TENANT_MODELS.has(model) &&
      readActions.has(params.action) &&
      params.action !== "findUnique" // findUnique by PK is always scoped (PK is globally unique)
    ) {
      const where = (params.args as { where?: Record<string, unknown> })?.where;
      // Allow queries scoped via workspaceId, projectId (which implies workspace), or taskId
      const hasScope =
        where &&
        (("workspaceId" in where) ||
          ("projectId" in where) ||
          ("taskId" in where) ||
          ("id" in where) ||
          ("OR" in where) ||
          ("AND" in where));
      if (!hasScope && process.env.NODE_ENV !== "production") {
        const stack = new Error().stack?.split("\n")[3]?.trim() ?? "";
        // Use process.stderr to avoid circular pino dependency in database package
        process.stderr.write(
          `[tenant-guard] Unscoped ${params.model}.${params.action} — missing workspaceId/projectId/taskId filter ${stack}\n`,
        );
      }
    }
    return next(params);
  });

  return base;
}

export const prisma: PrismaClient =
  globalThis.__aiHarnessPrisma ?? (globalThis.__aiHarnessPrisma = createClient());

export { PrismaClient };
export type { Prisma } from "@prisma/client";
