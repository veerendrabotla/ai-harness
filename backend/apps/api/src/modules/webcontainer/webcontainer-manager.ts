/**
 * WebContainer Manager.
 * Manages WebContainer sessions with DB persistence via raw queries.
 * Each session owns a private directory used for file sync and command execution.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { PrismaClient } from "@prisma/client";

interface WebContainerSession {
  id: string;
  workspace_id: string;
  status: string;
  created_at: Date;
  expires_at: Date;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function sessionsRoot(): string {
  return process.env.WEBCONTAINER_SESSIONS_DIR ?? join(tmpdir(), "ai-harness-webcontainer");
}

function sessionDir(sessionId: string): string {
  return join(sessionsRoot(), sessionId);
}

/** Resolve a caller-supplied relative path inside the session directory (rejects traversal). */
function safeResolve(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error(`Unsafe path: ${relativePath}`);
  }
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").some((seg) => seg === "..")) {
    throw new Error(`Unsafe path: ${relativePath}`);
  }
  const resolved = resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`Unsafe path: ${relativePath}`);
  }
  return resolved;
}

async function countFiles(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countFiles(join(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}

export class WebContainerManager {
  constructor(private readonly prisma: PrismaClient) {}

  async create(workspaceId: string, ttlMs = DEFAULT_TTL_MS): Promise<{ sessionId: string }> {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO webcontainer_sessions (id, workspace_id, status, expires_at, created_at)
       VALUES ($1::uuid, $2::uuid, 'RUNNING', $3, $4)`,
      sessionId, workspaceId, expiresAt, now,
    );

    try {
      await mkdir(sessionDir(sessionId), { recursive: true });
    } catch (err) {
      // Roll back the row so a session never exists without its directory.
      await this.prisma.$executeRawUnsafe(`DELETE FROM webcontainer_sessions WHERE id = $1::uuid`, sessionId);
      throw err;
    }

    return { sessionId };
  }

  async getStatus(sessionId: string): Promise<{ status: string; createdAt: string; expiresAt: string; fileCount: number; workspaceId: string } | null> {
    if (!isUuid(sessionId)) return null;
    const rows = await this.prisma.$queryRawUnsafe<WebContainerSession[]>(
      `SELECT * FROM webcontainer_sessions WHERE id = $1::uuid`, sessionId,
    );
    if (rows.length === 0) return null;
    const s = rows[0]!;
    return {
      status: s.status,
      createdAt: s.created_at.toISOString(),
      expiresAt: s.expires_at.toISOString(),
      fileCount: await countFiles(sessionDir(sessionId)),
      workspaceId: s.workspace_id,
    };
  }

  /** Write files into the session directory. Returns the number of files written. */
  async syncFiles(sessionId: string, files: Record<string, string>): Promise<number> {
    if (!isUuid(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
    const root = sessionDir(sessionId);
    await mkdir(root, { recursive: true });
    let synced = 0;
    for (const [relativePath, content] of Object.entries(files)) {
      const target = safeResolve(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      synced += 1;
    }
    return synced;
  }

  /** Ensure the session directory exists and return it (used as exec cwd). */
  async ensureSessionDir(sessionId: string): Promise<string> {
    if (!isUuid(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
    const dir = sessionDir(sessionId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async shutdown(sessionId: string): Promise<boolean> {
    if (!isUuid(sessionId)) return false;
    const result = await this.prisma.$executeRawUnsafe(
      `DELETE FROM webcontainer_sessions WHERE id = $1::uuid`,
      sessionId,
    );
    await rm(sessionDir(sessionId), { recursive: true, force: true });
    return result > 0;
  }

  async listByWorkspace(workspaceId: string): Promise<Array<{ sessionId: string; status: string; createdAt: string }>> {
    if (!isUuid(workspaceId)) return [];
    const rows = await this.prisma.$queryRawUnsafe<WebContainerSession[]>(
      `SELECT * FROM webcontainer_sessions WHERE workspace_id = $1::uuid AND expires_at > NOW() ORDER BY created_at DESC`,
      workspaceId,
    );
    return rows.map((s) => ({
      sessionId: s.id,
      status: s.status,
      createdAt: s.created_at.toISOString(),
    }));
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.prisma.$executeRawUnsafe(
      `DELETE FROM webcontainer_sessions WHERE expires_at < NOW()`,
    );
    return result;
  }
}

let manager: WebContainerManager | null = null;

export function getWebContainerManager(prisma: PrismaClient): WebContainerManager {
  if (!manager) manager = new WebContainerManager(prisma);
  return manager;
}
