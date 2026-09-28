import type { PrismaClient } from "@prisma/client";
import type { ProviderType } from "@ai-harness/contracts";
import { createLogger, decryptSecret, errors, getEnv } from "@ai-harness/shared";

const log = createLogger({ name: "model-router" });
import type { ProviderConnectionRef } from "@ai-harness/model-adapters";

export interface RouteDecision {
  providerConnection: ProviderConnectionRef;
  modelIdentifier: string;
  routeId: string | null;
  usedFallback: boolean;
  reason: string;
}

/**
 * Model Router (AGENT_RUNTIME.md §9).
 * Decision order:
 *   1. Task manual override (validated against workspace links + ACTIVE status)
 *   2. Active workspace route for the stage (lowest priority number first)
 *   3. Configured fallback chain of that route
 *   4. Fail with PROVIDER_UNAVAILABLE
 */
export class ModelRouter {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(input: {
    userId: string;
    workspaceId: string;
    stage: "PLANNING" | "IMPLEMENTATION" | "REVIEW";
    override?: { providerConnectionId: string; modelIdentifier: string } | null;
  }): Promise<RouteDecision> {
    if (input.override) {
      const conn = await this.prisma.providerConnection.findFirst({
        where: {
          id: input.override.providerConnectionId,
          userId: input.userId,
          status: "ACTIVE",
          workspaceLinks: { some: { workspaceId: input.workspaceId } },
        },
      });
      if (conn) {
        return {
          providerConnection: this.toRef(conn),
          modelIdentifier: input.override.modelIdentifier,
          routeId: null,
          usedFallback: false,
          reason: "Task manual override",
        };
      }
      throw errors.validation("Manual model override is not an ACTIVE connection linked to this workspace");
    }

    const routes = await this.prisma.modelRoute.findMany({
      where: { workspaceId: input.workspaceId, stage: input.stage, active: true },
      orderBy: { priority: "asc" },
      include: {
        providerConnection: true,
        fallbackRoute: { include: { providerConnection: true } },
      },
    });

    for (const route of routes) {
      if (
        route.providerConnection.status === "ACTIVE" &&
        (await this.isWorkspaceLinked(input.workspaceId, route.providerConnectionId))
      ) {
        return {
          providerConnection: this.toRef(route.providerConnection),
          modelIdentifier: route.modelIdentifier,
          routeId: route.id,
          usedFallback: false,
          reason: `Stage route for ${input.stage}`,
        };
      }
      // Configured fallback chain only — never a silent substitute provider.
      const visited = new Set<string>([route.id]);
      let fallback = route.fallbackRoute;
      while (fallback) {
        if (visited.has(fallback.id)) break; // cycle guard
        visited.add(fallback.id);
        if (
          fallback.active &&
          fallback.providerConnection.status === "ACTIVE" &&
          (await this.isWorkspaceLinked(input.workspaceId, fallback.providerConnectionId))
        ) {
          return {
            providerConnection: this.toRef(fallback.providerConnection),
            modelIdentifier: fallback.modelIdentifier,
            routeId: fallback.id,
            usedFallback: true,
            reason: `Fallback of route ${route.id}`,
          };
        }
        const next = await this.prisma.modelRoute.findUnique({
          where: { id: fallback.fallbackRouteId ?? "" },
          include: { providerConnection: true },
        });
        fallback = next;
      }
    }

    throw errors.providerUnavailable(
      `No active ${input.stage.toLowerCase()} route is configured with a reachable provider`,
    );
  }

  async resolveWithFallbacks(input: {
    userId: string;
    workspaceId: string;
    stage: "PLANNING" | "IMPLEMENTATION" | "REVIEW";
    override?: { providerConnectionId: string; modelIdentifier: string } | null;
  }): Promise<RouteDecision[]> {
    if (input.override) {
      const conn = await this.prisma.providerConnection.findFirst({
        where: {
          id: input.override.providerConnectionId,
          userId: input.userId,
          status: "ACTIVE",
          workspaceLinks: { some: { workspaceId: input.workspaceId } },
        },
      });
      if (conn) {
        return [
          {
            providerConnection: this.toRef(conn),
            modelIdentifier: input.override.modelIdentifier,
            routeId: null,
            usedFallback: false,
            reason: "Task manual override",
          },
        ];
      }
      throw errors.validation("Manual model override is not an ACTIVE connection linked to this workspace");
    }

    const routes = await this.prisma.modelRoute.findMany({
      where: { workspaceId: input.workspaceId, stage: input.stage, active: true },
      orderBy: { priority: "asc" },
      include: {
        providerConnection: true,
        fallbackRoute: { include: { providerConnection: true } },
      },
    });

    const result: RouteDecision[] = [];
    const seen = new Set<string>();

    for (const route of routes) {
      if (seen.has(route.id)) continue;
      const chain: RouteDecision[] = [];
      const visited = new Set<string>([route.id]);

      if (
        route.providerConnection.status === "ACTIVE" &&
        (await this.isWorkspaceLinked(input.workspaceId, route.providerConnectionId))
      ) {
        chain.push({
          providerConnection: this.toRef(route.providerConnection),
          modelIdentifier: route.modelIdentifier,
          routeId: route.id,
          usedFallback: false,
          reason: `Stage route for ${input.stage}`,
        });
      }

      let fallback: typeof route.fallbackRoute = route.fallbackRoute;
      while (fallback) {
        if (visited.has(fallback.id)) break;
        visited.add(fallback.id);
        if (!seen.has(fallback.id) && !chain.some((c) => c.routeId === fallback!.id)) {
          if (
            fallback.active &&
            fallback.providerConnection.status === "ACTIVE" &&
            (await this.isWorkspaceLinked(input.workspaceId, fallback.providerConnectionId))
          ) {
            chain.push({
              providerConnection: this.toRef(fallback.providerConnection),
              modelIdentifier: fallback.modelIdentifier,
              routeId: fallback.id,
              usedFallback: true,
              reason: `Fallback of route ${route.id}`,
            });
          }
        }
        if (!fallback.fallbackRouteId) break;
        const next = await this.prisma.modelRoute.findUnique({
          where: { id: fallback.fallbackRouteId },
          include: { providerConnection: true },
        });
        if (!next) break;
        fallback = next as unknown as typeof route.fallbackRoute;
      }

      if (chain.length > 0) {
        for (const d of chain) {
          if (d.routeId && !seen.has(d.routeId)) {
            result.push(d);
            seen.add(d.routeId);
          } else if (!d.routeId) {
            result.push(d);
          }
        }
        // Return the fallback chain for the first route that has any viable candidate.
        // This preserves the priority + fallback-chain ordering expected by callers
        // while still allowing full iteration on retryable failures.
        return result;
      }
      seen.add(route.id);
      // Mark fallback ids as seen even if not viable to avoid reprocessing the same chain
      let walk: typeof route.fallbackRoute = route.fallbackRoute;
      const walkVisited = new Set<string>();
      while (walk && !walkVisited.has(walk.id)) {
        walkVisited.add(walk.id);
        seen.add(walk.id);
        if (!walk.fallbackRouteId) break;
        const nxt = await this.prisma.modelRoute.findUnique({
          where: { id: walk.fallbackRouteId },
          include: { providerConnection: true },
        });
        if (!nxt) break;
        walk = nxt as unknown as typeof route.fallbackRoute;
      }
    }

    if (result.length > 0) return result;

    throw errors.providerUnavailable(
      `No active ${input.stage.toLowerCase()} route is configured with a reachable provider`,
    );
  }

  private toRef(conn: {
    id: string;
    providerType: ProviderType;
    displayName: string;
    encryptedCredential: Uint8Array | Buffer | null;
    encryptedMetadata?: Uint8Array | Buffer | null;
  }): ProviderConnectionRef {
    const env = getEnv();
    const credential =
      conn.encryptedCredential
        ? decryptSecret(Buffer.from(conn.encryptedCredential), env.ENCRYPTION_KEY)
        : "";
    let metadata: Record<string, string> = {};
    if (conn.encryptedMetadata) {
      try {
        const parsed: unknown = JSON.parse(
          decryptSecret(Buffer.from(conn.encryptedMetadata), env.ENCRYPTION_KEY),
        );
        if (parsed && typeof parsed === "object") {
          metadata = parsed as Record<string, string>;
        }
      } catch (err) {
        log.warn({ err }, "failed to decrypt provider metadata");
        metadata = {};
      }
    }
    return {
      id: conn.id,
      providerType: conn.providerType,
      displayName: conn.displayName,
      credential,
      metadata,
    };
  }

  private async isWorkspaceLinked(workspaceId: string, providerConnectionId: string): Promise<boolean> {
    const link = await this.prisma.workspaceProviderConnection.findUnique({
      where: {
        workspaceId_providerConnectionId: { workspaceId, providerConnectionId },
      },
    });
    return Boolean(link);
  }
}
