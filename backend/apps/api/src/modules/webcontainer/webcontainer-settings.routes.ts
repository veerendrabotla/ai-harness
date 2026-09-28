/**
 * WebContainer Settings Routes.
 * Persist workspace WebContainer settings to DB via raw queries.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret, getEnv } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";

interface WebContainerSettings {
  apiKey?: string;
  defaultTemplate?: string;
  autoStart?: boolean;
  maxSessions?: number;
}

interface SettingRow {
  id: string;
  workspace_id: string;
  settings: string;
  created_at: Date;
  updated_at: Date;
}

function parseSettings(row: SettingRow): WebContainerSettings {
  const raw = typeof row.settings === "string" ? row.settings : JSON.stringify(row.settings);
  try {
    return JSON.parse(raw);
  } catch {
    return { defaultTemplate: "node", autoStart: false, maxSessions: 5 };
  }
}

export default function registerWebContainerSettingsRoutes(app: FastifyInstance) {
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/settings/webcontainer", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "Get WebContainer settings for a workspace",
    },
  }, async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const rows = await app.prisma.$queryRawUnsafe<SettingRow[]>(
      `SELECT * FROM webcontainer_settings WHERE workspace_id = $1`, workspaceId,
    );

    const settings = rows.length > 0
      ? parseSettings(rows[0]!)
      : { defaultTemplate: "node", autoStart: false, maxSessions: 5 };

    // Decrypt API key if present
    if (settings.apiKey) {
      try {
        settings.apiKey = decryptSecret(Buffer.from(settings.apiKey, "base64"), getEnv().ENCRYPTION_KEY);
      } catch {
        settings.apiKey = undefined;
      }
    }

    return ok(reply, { settings });
  });

  app.put<{
    Params: { workspaceId: string };
    Body: WebContainerSettings;
  }>("/v1/workspaces/:workspaceId/settings/webcontainer", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["webcontainer"],
      summary: "Update WebContainer settings for a workspace",
    },
  }, async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as WebContainerSettings;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    // Get existing
    const rows = await app.prisma.$queryRawUnsafe<SettingRow[]>(
      `SELECT * FROM webcontainer_settings WHERE workspace_id = $1`, workspaceId,
    );

    const current = rows.length > 0 ? parseSettings(rows[0]!) : {};
    const updated: WebContainerSettings = {
      ...current,
      ...(body.apiKey !== undefined && { apiKey: body.apiKey }),
      ...(body.defaultTemplate !== undefined && { defaultTemplate: body.defaultTemplate }),
      ...(body.autoStart !== undefined && { autoStart: body.autoStart }),
      ...(body.maxSessions !== undefined && { maxSessions: Math.min(Math.max(body.maxSessions, 1), 20) }),
    };

    // Encrypt API key before storing
    const settingsToStore = { ...updated };
    if (settingsToStore.apiKey) {
      settingsToStore.apiKey = encryptSecret(settingsToStore.apiKey, getEnv().ENCRYPTION_KEY).toString("base64");
    }

    const jsonSettings = JSON.stringify(settingsToStore);

    // Atomic upsert: INSERT ... ON CONFLICT UPDATE to prevent lost updates
    const existingRow = rows.length > 0 ? rows[0]! : null;
    if (existingRow) {
      await app.prisma.$executeRawUnsafe(
        `UPDATE webcontainer_settings SET settings = $1::jsonb, updated_at = NOW() WHERE workspace_id = $2`,
        jsonSettings, workspaceId,
      );
    } else {
      await app.prisma.$executeRawUnsafe(
        `INSERT INTO webcontainer_settings (id, workspace_id, settings, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::jsonb, NOW(), NOW())
         ON CONFLICT (workspace_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
        randomUUID(), workspaceId, jsonSettings,
      );
    }

    return ok(reply, { settings: updated });
  });
}
