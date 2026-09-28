import type { FastifyInstance } from "fastify";
import { ok, reqParam } from "../../lib/http.js";
import {
  getConnectedUsers,
  broadcastCursor,
  broadcastSelection,
  type UserPresence,
} from "./multiplayer.gateway.js";

export default function registerMultiplayerRoutes(app: FastifyInstance) {
  app.post("/v1/multiplayer/:taskId/join", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["multiplayer"],
      summary: "Join a multiplayer session for a task",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const user = req.user!;
    return ok(reply, {
      taskId,
      userId: user.sub,
      wsUrl: `/multiplayer?taskId=${taskId}&userId=${user.sub}&userName=${user.email}`,
    });
  });

  app.get("/v1/multiplayer/:taskId/users", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["multiplayer"],
      summary: "Get connected users in a multiplayer session",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const users: UserPresence[] = await getConnectedUsers(taskId);
    return ok(reply, { users });
  });

  app.post("/v1/multiplayer/:taskId/cursor", {
    preHandler: [app.authenticate],
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: (req) => (req.user as { sub?: string } | undefined)?.sub ?? req.ip },
    },
    schema: {
      tags: ["multiplayer"],
      summary: "Broadcast cursor position to other users",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
      body: {
        type: "object",
        properties: {
          line: { type: "integer" },
          column: { type: "integer" },
          file: { type: "string" },
        },
        required: ["line", "column"],
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const user = req.user!;
    const body = (req.body ?? {}) as { line: number; column: number; file?: string };
    broadcastCursor(taskId, user.sub, { line: body.line, column: body.column, file: body.file });
    return ok(reply, { ok: true });
  });

  app.post("/v1/multiplayer/:taskId/selection", {
    preHandler: [app.authenticate],
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: (req) => (req.user as { sub?: string } | undefined)?.sub ?? req.ip },
    },
    schema: {
      tags: ["multiplayer"],
      summary: "Broadcast selection range to other users",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
      body: {
        type: "object",
        properties: {
          startLine: { type: "integer" },
          startColumn: { type: "integer" },
          endLine: { type: "integer" },
          endColumn: { type: "integer" },
          file: { type: "string" },
        },
        required: ["startLine", "startColumn", "endLine", "endColumn"],
      },
    },
  }, async (req, reply) => {
    const taskId = reqParam(req, "taskId");
    const user = req.user!;
    const body = (req.body ?? {}) as { startLine: number; startColumn: number; endLine: number; endColumn: number; file?: string };
    broadcastSelection(taskId, user.sub, {
      startLine: body.startLine,
      startColumn: body.startColumn,
      endLine: body.endLine,
      endColumn: body.endColumn,
      file: body.file,
    });
    return ok(reply, { ok: true });
  });
}
