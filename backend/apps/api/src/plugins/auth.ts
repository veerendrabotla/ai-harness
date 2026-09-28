import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyAccessToken, type AccessTokenClaims } from "../lib/tokens.js";
import { errors } from "@ai-harness/shared";

declare module "fastify" {
  interface FastifyRequest {
    user: AccessTokenClaims | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    requireWorkspaceRole: (
      req: FastifyRequest,
      workspaceId: string,
      minimum: "OWNER" | "MEMBER" | "VIEWER",
    ) => Promise<{ role: "OWNER" | "MEMBER" | "VIEWER"; workspaceId: string; status: "ACTIVE" | "ARCHIVED" }>;
    requirePlatformAdmin: (req: FastifyRequest) => Promise<void>;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("user", null);

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw errors.unauthenticated();
    const token = header.slice("Bearer ".length).trim();
    try {
      req.user = await verifyAccessToken(token);
    } catch (err) {
      app.log.debug({ err }, "Invalid access token");
      throw errors.unauthenticated("Access token is invalid or expired");
    }
  });

  /**
   * FR-002: every workspace-scoped request verifies membership and role.
   * Returns membership + workspace lifecycle so handlers can enforce
   * archived-workspace rules consistently.
   */
  app.decorate(
    "requireWorkspaceRole",
    async (
      req: FastifyRequest,
      workspaceId: string,
      minimum: "OWNER" | "MEMBER" | "VIEWER",
    ) => {
      if (!req.user) throw errors.unauthenticated();
      const { prisma } = await import("@ai-harness/database");
      const ROLE_RANK = { VIEWER: 1, MEMBER: 2, OWNER: 3 } as const;
      const [membership, workspace] = await Promise.all([
        prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: req.user.sub } },
          select: { role: true },
        }),
        prisma.workspace.findUnique({ where: { id: workspaceId }, select: { status: true } }),
      ]);
      if (!membership || !workspace) throw errors.notFound("Workspace");
      if (ROLE_RANK[membership.role] < ROLE_RANK[minimum]) throw errors.forbidden();
      return { role: membership.role, workspaceId, status: workspace.status };
    },
  );

  /**
   * Platform admin check: verifies the user has PLATFORM_ADMIN role.
   * Used for admin-only routes like user management, system config, etc.
   */
  app.decorate(
    "requirePlatformAdmin",
    async (req: FastifyRequest) => {
      if (!req.user) throw errors.unauthenticated();
      const { prisma } = await import("@ai-harness/database");
      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { platformRole: true },
      });
      if (!user || user.platformRole !== "PLATFORM_ADMIN") {
        throw errors.forbidden();
      }
    },
  );
});
