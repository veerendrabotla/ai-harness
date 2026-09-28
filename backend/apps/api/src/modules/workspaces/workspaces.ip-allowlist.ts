/**
 * IP Allowlist Management Routes.
 * Manage workspace IP allowlisting for access control.
 */
import type { FastifyInstance } from "fastify";
import { errors } from "@ai-harness/shared";
import { ok } from "../../lib/http.js";
import { auditFromRequest } from "../../lib/audit.js";

export default function registerIpAllowlistRoutes(app: FastifyInstance) {
  /**
   * Get IP allowlist for workspace.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/ip-allowlist", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["ip-allowlist"],
      summary: "Get IP allowlist settings",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const workspace = await app.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        ipAllowlist: true,
        ipAllowlistEnabled: true,
      },
    });

    if (!workspace) throw errors.notFound("Workspace");

    return ok(reply, {
      enabled: workspace.ipAllowlistEnabled,
      allowedIPs: workspace.ipAllowlist,
    });
  });

  /**
   * Update IP allowlist for workspace.
   */
  app.put<{
    Params: { workspaceId: string };
    Body: { enabled?: boolean; allowedIPs?: string[] };
  }>("/v1/workspaces/:workspaceId/ip-allowlist", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["ip-allowlist"],
      summary: "Update IP allowlist settings",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          allowedIPs: {
            type: "array",
            items: { type: "string" },
            maxItems: 100,
          },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const { enabled, allowedIPs } = req.body as { enabled?: boolean; allowedIPs?: string[] };

    // Validate IPs if provided
    if (allowedIPs) {
      for (const ip of allowedIPs) {
        if (!isValidIPOrCIDR(ip)) {
          throw errors.validation(`Invalid IP or CIDR: ${ip}`);
        }
      }
    }

    const updated = await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(enabled !== undefined && { ipAllowlistEnabled: enabled }),
        ...(allowedIPs !== undefined && { ipAllowlist: allowedIPs }),
      },
      select: {
        ipAllowlist: true,
        ipAllowlistEnabled: true,
      },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "IP_ALLOWLIST_UPDATED",
      enabled: updated.ipAllowlistEnabled,
      ipCount: updated.ipAllowlist.length,
    });

    return ok(reply, {
      enabled: updated.ipAllowlistEnabled,
      allowedIPs: updated.ipAllowlist,
    });
  });

  /**
   * Add IP to allowlist.
   */
  app.post<{
    Params: { workspaceId: string };
    Body: { ip: string; label?: string };
  }>("/v1/workspaces/:workspaceId/ip-allowlist/entries", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["ip-allowlist"],
      summary: "Add IP to allowlist",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["ip"],
        properties: {
          ip: { type: "string" },
          label: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const { ip } = req.body as { ip: string; label?: string };
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    if (!isValidIPOrCIDR(ip)) {
      throw errors.validation(`Invalid IP or CIDR: ${ip}`);
    }

    const workspace = await app.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ipAllowlist: true },
    });

    if (!workspace) throw errors.notFound("Workspace");
    if (workspace.ipAllowlist.includes(ip)) {
      throw errors.conflict("IP already in allowlist");
    }

    if (workspace.ipAllowlist.length >= 100) {
      throw errors.validation("Maximum 100 IP entries allowed");
    }

    const updated = await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ipAllowlist: [...workspace.ipAllowlist, ip],
        ipAllowlistEnabled: true,
      },
      select: { ipAllowlist: true },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "IP_ALLOWLIST_ENTRY_ADDED",
      ip,
    });

    return ok(reply, { allowedIPs: updated.ipAllowlist }, 201);
  });

  /**
   * Remove IP from allowlist.
   */
  app.delete<{
    Params: { workspaceId: string; ip: string };
  }>("/v1/workspaces/:workspaceId/ip-allowlist/entries/:ip", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["ip-allowlist"],
      summary: "Remove IP from allowlist",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    const ip = (req.params as { ip: string }).ip;
    await app.requireWorkspaceRole(req, workspaceId, "OWNER");

    const workspace = await app.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ipAllowlist: true },
    });

    if (!workspace) throw errors.notFound("Workspace");

    const newAllowlist = workspace.ipAllowlist.filter((entry) => entry !== ip);
    if (newAllowlist.length === workspace.ipAllowlist.length) {
      throw errors.notFound("IP entry");
    }

    const updated = await app.prisma.workspace.update({
      where: { id: workspaceId },
      data: { ipAllowlist: newAllowlist },
      select: { ipAllowlist: true },
    });

    await auditFromRequest(app.prisma, req, "WORKSPACE_UPDATED", "WORKSPACE", workspaceId, workspaceId, {
      action: "IP_ALLOWLIST_ENTRY_REMOVED",
      ip,
    });

    return ok(reply, { allowedIPs: updated.ipAllowlist });
  });

  /**
   * Test if current request IP is allowed.
   */
  app.get<{
    Params: { workspaceId: string };
  }>("/v1/workspaces/:workspaceId/ip-allowlist/check", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["ip-allowlist"],
      summary: "Check if current IP is allowed",
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    const workspaceId = (req.params as { workspaceId: string }).workspaceId;
    await app.requireWorkspaceRole(req, workspaceId, "MEMBER");

    const workspace = await app.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ipAllowlist: true, ipAllowlistEnabled: true },
    });

    if (!workspace) throw errors.notFound("Workspace");

    if (!workspace.ipAllowlistEnabled) {
      return ok(reply, { allowed: true, reason: "IP allowlist is disabled" });
    }

    const clientIP = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      ?? (req.headers["x-real-ip"] as string)
      ?? req.ip
      ?? "127.0.0.1";

    const normalizedIP = clientIP.replace(/^::ffff:/, "");
    const allowed = workspace.ipAllowlist.some((entry) => {
      if (entry.includes("/")) {
        return matchCIDR(normalizedIP, entry);
      }
      return normalizedIP === entry;
    });

    return ok(reply, {
      allowed,
      clientIP: normalizedIP,
      reason: allowed ? "IP is in allowlist" : "IP is not in allowlist",
    });
  });
}

function isValidIPOrCIDR(value: string): boolean {
  const cidrPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  if (!cidrPattern.test(value)) return false;

  const parts = value.split("/");
  const ipParts = (parts[0] ?? "").split(".");
  for (const part of ipParts) {
    const num = parseInt(part, 10);
    if (num < 0 || num > 255) return false;
  }

  if (parts[1]) {
    const prefix = parseInt(parts[1], 10);
    if (prefix < 0 || prefix > 32) return false;
  }

  return true;
}

function matchCIDR(ip: string, cidr: string): boolean {
  const parts = cidr.split("/");
  const range = parts[0] ?? "";
  const prefixStr = parts[1] ?? "32";
  const prefixLength = parseInt(prefixStr, 10);

  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  const mask = ~((1 << (32 - prefixLength)) - 1);

  return (ipNum & mask) === (rangeNum & mask);
}

function ipToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  const p0 = parts[0] ?? 0;
  const p1 = parts[1] ?? 0;
  const p2 = parts[2] ?? 0;
  const p3 = parts[3] ?? 0;
  return ((p0 << 24) | (p1 << 16) | (p2 << 8) | p3) >>> 0;
}
