import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok, reqParam } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

interface BackupSnapshot {
  id: string;
  workspaceId: string;
  createdAt: string;
  sizeBytes: number;
  data: {
    projects: Array<{
      id: string;
      name: string;
      createdAt: string;
      tasks: Array<{
        id: string;
        goal: string;
        state: string;
        createdAt: string;
      }>;
      envVars: Array<{ id: string; key: string; environment: string }>;
    }>;
    apiKeys: Array<{ id: string; name: string; keyPrefix: string; createdAt: string }>;
    featureFlags: Array<{ id: string; key: string; enabled: boolean; createdAt: string }>;
    settings: {
      name: string;
      description: string | null;
      executionMode: string;
      status: string;
    };
  };
}

const MAX_BACKUPS = 10;
const BACKUP_TTL_MS = 24 * 60 * 60 * 1000;

export default function registerBackupRoutes(app: FastifyInstance) {
  app.post("/v1/workspaces/:workspaceId/backup", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspace-backups"],
      summary: "Create a workspace snapshot",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const ws = await app.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw errors.notFound("Workspace");

    const projects = await app.prisma.project.findMany({
      where: { workspaceId },
      include: {
        tasks: {
          select: { id: true, goal: true, state: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        },
        envVars: {
          select: { id: true, key: true, environment: true },
        },
      },
    });

    const apiKeys = await app.prisma.apiKey.findMany({
      where: { workspaceId },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const featureFlags = await app.prisma.featureFlag.findMany({
      where: { workspaceId },
      select: { id: true, key: true, enabled: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const snapshot: BackupSnapshot = {
      id: randomUUID(),
      workspaceId,
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      data: {
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.createdAt.toISOString(),
          tasks: p.tasks.map((t) => ({
            id: t.id,
            goal: t.goal,
            state: t.state,
            createdAt: t.createdAt.toISOString(),
          })),
          envVars: p.envVars.map((e) => ({
            id: e.id,
            key: e.key,
            environment: e.environment,
          })),
        })),
        apiKeys: apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          createdAt: k.createdAt.toISOString(),
        })),
        featureFlags: featureFlags.map((f) => ({
          id: f.id,
          key: f.key,
          enabled: f.enabled,
          createdAt: f.createdAt.toISOString(),
        })),
        settings: {
          name: ws.name,
          description: ws.description,
          executionMode: ws.executionMode,
          status: ws.status,
        },
      },
    };

    snapshot.sizeBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf-8");

    // Persist to database
    await app.prisma.workspaceBackup.create({
      data: {
        workspaceId,
        sizeBytes: snapshot.sizeBytes,
        data: JSON.parse(JSON.stringify(snapshot)),
      },
    });

    // Evict old backups (keep MAX_BACKUPS most recent)
    const allBackups = await app.prisma.workspaceBackup.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    if (allBackups.length > MAX_BACKUPS) {
      const toDelete = allBackups.slice(MAX_BACKUPS);
      await app.prisma.workspaceBackup.deleteMany({
        where: { id: { in: toDelete.map((b) => b.id) } },
      });
    }

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "BACKUP_CREATED",
      backupId: snapshot.id,
      sizeBytes: snapshot.sizeBytes,
    });

    return ok(reply, {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      sizeBytes: snapshot.sizeBytes,
    }, 201);
  });

  app.get("/v1/workspaces/:workspaceId/backups", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspace-backups"],
      summary: "List recent backups",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "VIEWER");

    const cutoff = new Date(Date.now() - BACKUP_TTL_MS);
    const store = await app.prisma.workspaceBackup.findMany({
      where: { workspaceId, createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
    });

    return ok(reply, store.map((s) => {
      const data = s.data as { projects?: unknown[] };
      return {
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        sizeBytes: s.sizeBytes,
        projectCount: data.projects?.length ?? 0,
      };
    }));
  });

  app.post("/v1/workspaces/:workspaceId/restore", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspace-backups"],
      summary: "Restore from a backup",
      params: {
        type: "object",
        required: ["workspaceId"],
        properties: { workspaceId: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["backupId", "confirm"],
        properties: {
          backupId: { type: "string", format: "uuid" },
          confirm: { type: "boolean", enum: [true] },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const { backupId, confirm } = req.body as { backupId: string; confirm: boolean };
    if (!confirm) {
      throw errors.validation("Restore requires explicit confirmation (confirm: true)");
    }

    const backup = await app.prisma.workspaceBackup.findUnique({ where: { id: backupId } });
    if (!backup || backup.workspaceId !== workspaceId) throw errors.notFound("Backup");

    const backupData = backup.data as BackupSnapshot["data"];

    // Restore workspace settings
    if (backupData.settings) {
      await app.prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          name: backupData.settings.name,
          description: backupData.settings.description,
        },
      });
    }

    // Restore projects, tasks, env vars, api keys, feature flags
    let projectsRestored = 0;
    let tasksRestored = 0;

    for (const proj of backupData.projects ?? []) {
      const newProject = await app.prisma.project.create({
        data: {
          workspaceId,
          name: proj.name,
          connectionType: "CLOUD",
          rootReference: "/",
        },
      });
      projectsRestored++;

      for (const task of proj.tasks ?? []) {
        await app.prisma.task.create({
          data: {
            projectId: newProject.id,
            workspaceId,
            goal: task.goal,
            state: task.state as never,
            createdBy: workspaceId,
          },
        });
        tasksRestored++;
      }

      for (const envVar of proj.envVars ?? []) {
        await app.prisma.deploymentEnvVar.create({
          data: {
            projectId: newProject.id,
            key: envVar.key,
            encryptedValue: "",
            environment: envVar.environment,
          },
        });
      }
    }

    // Restore API keys
    for (const apiKey of backupData.apiKeys ?? []) {
      await app.prisma.apiKey.create({
        data: {
          workspaceId,
          name: apiKey.name,
          keyHash: apiKey.keyPrefix,
          keyPrefix: apiKey.keyPrefix.slice(0, 8),
        },
      });
    }

    // Restore feature flags
    for (const flag of backupData.featureFlags ?? []) {
      await app.prisma.featureFlag.create({
        data: {
          workspaceId,
          key: flag.key,
          enabled: flag.enabled,
        },
      });
    }

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "BACKUP_RESTORED",
      backupId: backup.id,
      projectsRestored,
      tasksRestored,
    });

    return ok(reply, {
      restored: true,
      backupId: backup.id,
      createdAt: backup.createdAt.toISOString(),
      projectsRestored,
      tasksRestored,
    });
  });

  app.delete("/v1/workspaces/:workspaceId/backups/:backupId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["workspace-backups"],
      summary: "Delete a backup",
      params: {
        type: "object",
        required: ["workspaceId", "backupId"],
        properties: {
          workspaceId: { type: "string", format: "uuid" },
          backupId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = reqParam(req, "workspaceId");
    const backupId = reqParam(req, "backupId");
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const backup = await app.prisma.workspaceBackup.findUnique({ where: { id: backupId } });
    if (!backup || backup.workspaceId !== workspaceId) throw errors.notFound("Backup");

    await app.prisma.workspaceBackup.delete({ where: { id: backupId } });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "BACKUP_DELETED",
      backupId,
    });

    return ok(reply, { success: true });
  });
}
