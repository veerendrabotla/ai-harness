import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BridgeGatewayClient, errors, getEnv } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import { ok, reqParam } from "../../lib/http.js";

const inspectSchema = z.object({
  op: z.enum(["git.status", "git.diff", "fs.list", "fs.read", "ckpt.diff"]),
  args: z
    .record(z.unknown())
    .default({})
    .refine(
      (a) => !("ref" in a) || /^[0-9a-f]{40}$/i.test(String(a["ref"])),
      { message: "ref must be a commit sha" },
    ),
});

/**
 * Read-only project inspection through the Local Bridge.
 * Powers the workspace Changes/Git views without giving the browser any
 * direct filesystem authority (PRD F-03/F-15).
 */
export function registerProjectInspectRoutes(app: FastifyInstance) {
  const audit = createAuditRepository(app.prisma);

  app.post("/v1/projects/:projectId/inspect", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = inspectSchema.parse(req.body);

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      include: { bridge: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    if (project.connectionType !== "LOCAL_BRIDGE" || !project.bridgeId || !project.bridge) {
      throw errors.projectUnavailable(
        "Inspection requires a Local Bridge project; cloud sandbox arrives later",
      );
    }
    if (project.bridge.status !== "CONNECTED") {
      throw errors.bridgeDisconnected("The bridge owning this project is not connected");
    }

    const env = getEnv();
    const gateway = new BridgeGatewayClient({ baseUrl: env.BRIDGE_GATEWAY_URL, internalToken: env.BRIDGE_INTERNAL_TOKEN });
    const response = await gateway.execute(project.bridgeId, input.op, { root: project.rootReference, ...input.args }, 60_000);
    if (!response.ok) {
      throw makeBridgeAppError(response.error);
    }
    await audit.record({
      actorUserId: req.user!.sub,
      workspaceId: project.workspaceId,
      action: "PROJECT_INSPECTED",
      entityType: "PROJECT",
      entityId: projectId,
      metadata: { op: input.op },
    });
    return ok(reply, response.data ?? {});
  });
}

import { AppError, ERROR_CODES } from "@ai-harness/shared";
function makeBridgeAppError(error?: { code?: string; message?: string }): AppError {
  const code = error?.code ?? "INTERNAL_ERROR";
  const safeCode = (ERROR_CODES as readonly string[]).includes(code)
    ? (code as (typeof ERROR_CODES)[number])
    : "INTERNAL_ERROR";
  return new AppError(safeCode, error?.message ?? "Bridge call failed");
}
