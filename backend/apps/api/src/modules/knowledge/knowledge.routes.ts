/**
 * Knowledge Base Routes.
 * CRUD for workspace-scoped knowledge base entries.
 * Uses raw queries since the KnowledgeEntry model was added after last Prisma generate.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { AppError, errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

const VALID_TYPES = ["DOCUMENT", "CODE_SNIPPET", "LINK", "NOTE"] as const;

interface KnowledgeRow {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  type: string;
  tags: string;
  created_at: Date;
  updated_at: Date;
}

function serialize(row: KnowledgeRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    content: row.content,
    type: row.type,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

export default function registerKnowledgeRoutes(app: FastifyInstance) {
  /**
   * List knowledge base entries for a workspace.
   */
  app.get("/v1/knowledge", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["knowledge"],
      summary: "List knowledge base entries",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        required: ["workspaceId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          type: { type: "string", enum: [...VALID_TYPES] },
          search: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw errors.unauthenticated();
      const { workspaceId, type, search } = req.query as {
        workspaceId: string;
        type?: string;
        search?: string;
      };

      await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

      let query = `SELECT * FROM knowledge_entries WHERE workspace_id = $1::uuid`;
      const params: unknown[] = [workspaceId];
      let paramIdx = 2;

      if (type && VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
        query += ` AND type = $${paramIdx}::"KnowledgeEntryType"`;
        params.push(type);
        paramIdx++;
      }
      if (search) {
        query += ` AND (title ILIKE $${paramIdx} OR content ILIKE $${paramIdx})`;
        params.push(`%${search}%`);
        paramIdx++;
      }
      query += ` ORDER BY created_at DESC LIMIT 200`;

      const rows = await app.prisma.$queryRawUnsafe<KnowledgeRow[]>(query, ...params);
      return ok(reply, { entries: rows.map(serialize) });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw errors.internal(String(err));
    }
  });

  /**
   * Get a single knowledge entry.
   */
  app.get<{
    Params: { id: string };
  }>("/v1/knowledge/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["knowledge"],
      summary: "Get a knowledge base entry",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw errors.unauthenticated();
      const { id } = req.params as { id: string };

      const rows = await app.prisma.$queryRawUnsafe<KnowledgeRow[]>(
        `SELECT * FROM knowledge_entries WHERE id = $1::uuid`, id,
      );
      if (rows.length === 0) throw errors.notFound("Knowledge entry");
      const entry = rows[0]!;
      await app.requireWorkspaceRole(req, entry.workspace_id, "VIEWER");

      return ok(reply, serialize(entry));
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw errors.internal(String(err));
    }
  });

  /**
   * Create a knowledge base entry.
   */
  app.post("/v1/knowledge", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["knowledge"],
      summary: "Create a knowledge base entry",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["workspaceId", "title", "content"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 1, maxLength: 500 },
          content: { type: "string" },
          type: { type: "string", enum: [...VALID_TYPES] },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw errors.unauthenticated();
      const { workspaceId, title, content, type = "NOTE", tags = [] } = req.body as {
        workspaceId: string;
        title: string;
        content: string;
        type?: string;
        tags?: string[];
      };

      await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

      const id = randomUUID();
      const entryType = VALID_TYPES.includes(type as typeof VALID_TYPES[number]) ? type : "NOTE";
      const tagsJson = JSON.stringify(tags);

      await app.prisma.$executeRawUnsafe(
        `INSERT INTO knowledge_entries (id, workspace_id, title, content, type, tags, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::"KnowledgeEntryType", $6::jsonb, NOW(), NOW())`,
        id, workspaceId, title, content, entryType, tagsJson,
      );

      const rows = await app.prisma.$queryRawUnsafe<KnowledgeRow[]>(
        `SELECT * FROM knowledge_entries WHERE id = $1::uuid`, id,
      );

      return ok(reply, serialize(rows[0]!), 201);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw errors.internal(String(err));
    }
  });

  /**
   * Update a knowledge base entry.
   */
  app.put<{
    Params: { id: string };
  }>("/v1/knowledge/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["knowledge"],
      summary: "Update a knowledge base entry",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
          content: { type: "string" },
          type: { type: "string", enum: [...VALID_TYPES] },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw errors.unauthenticated();
      const { id } = req.params as { id: string };
      const body = req.body as {
        title?: string;
        content?: string;
        type?: string;
        tags?: string[];
      };

      const existing = await app.prisma.$queryRawUnsafe<KnowledgeRow[]>(
        `SELECT * FROM knowledge_entries WHERE id = $1::uuid`, id,
      );
      if (existing.length === 0) throw errors.notFound("Knowledge entry");
      await app.requireWorkspaceRole(req, existing[0]!.workspace_id, "MEMBER");

      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (body.title !== undefined) { updates.push(`title = $${paramIdx}`); params.push(body.title); paramIdx++; }
      if (body.content !== undefined) { updates.push(`content = $${paramIdx}`); params.push(body.content); paramIdx++; }
      if (body.type !== undefined && VALID_TYPES.includes(body.type as typeof VALID_TYPES[number])) {
        updates.push(`type = $${paramIdx}::"KnowledgeEntryType"`); params.push(body.type); paramIdx++;
      }
      if (body.tags !== undefined) { updates.push(`tags = $${paramIdx}::jsonb`); params.push(JSON.stringify(body.tags)); paramIdx++; }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(id);
        await app.prisma.$executeRawUnsafe(
          `UPDATE knowledge_entries SET ${updates.join(", ")} WHERE id = $${paramIdx}::uuid`,
          ...params,
        );
      }

      const rows = await app.prisma.$queryRawUnsafe<KnowledgeRow[]>(
        `SELECT * FROM knowledge_entries WHERE id = $1::uuid`, id,
      );
      return ok(reply, serialize(rows[0]!));
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw errors.internal(String(err));
    }
  });

  /**
   * Delete a knowledge base entry.
   */
  app.delete<{
    Params: { id: string };
  }>("/v1/knowledge/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["knowledge"],
      summary: "Delete a knowledge base entry",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    try {
      const userId = req.user?.sub;
      if (!userId) throw errors.unauthenticated();
      const { id } = req.params as { id: string };

      const existing = await app.prisma.$queryRawUnsafe<KnowledgeRow[]>(
        `SELECT * FROM knowledge_entries WHERE id = $1::uuid`, id,
      );
      if (existing.length === 0) throw errors.notFound("Knowledge entry");
      await app.requireWorkspaceRole(req, existing[0]!.workspace_id, "MEMBER");

      await app.prisma.$executeRawUnsafe(`DELETE FROM knowledge_entries WHERE id = $1::uuid`, id);
      return ok(reply, { success: true });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw errors.internal(String(err));
    }
  });
}
