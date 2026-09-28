/**
 * IP Allowlisting Middleware.
 * Restricts workspace access based on IP addresses.
 */
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Check if IP is in allowlist.
 */
function isIPAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  
  // Normalize IP (remove IPv6 prefix)
  const normalizedIP = ip.replace(/^::ffff:/, "");
  
  return allowlist.some((allowed) => {
    // Support CIDR notation
    if (allowed.includes("/")) {
      return matchCIDR(normalizedIP, allowed);
    }
    return normalizedIP === allowed;
  });
}

/**
 * Match IP against CIDR range (simplified implementation).
 */
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

/**
 * Convert IP address to number.
 */
function ipToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  const p0 = parts[0] ?? 0;
  const p1 = parts[1] ?? 0;
  const p2 = parts[2] ?? 0;
  const p3 = parts[3] ?? 0;
  return ((p0 << 24) | (p1 << 16) | (p2 << 8) | p3) >>> 0;
}

/**
 * Get client IP from request.
 */
function getClientIP(req: FastifyRequest): string {
  // Check X-Forwarded-For header first (for proxied requests)
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    if (ips) {
      return ips.split(",")[0]?.trim() ?? "127.0.0.1";
    }
  }
  
  // Check X-Real-IP header
  const realIP = req.headers["x-real-ip"];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] ?? "127.0.0.1" : realIP;
  }
  
  // Fall back to socket IP
  return req.ip ?? "127.0.0.1";
}

/**
 * IP allowlisting middleware.
 */
export async function ipAllowlistMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const workspaceId = (req.params as { workspaceId?: string })?.workspaceId;
  if (!workspaceId) return;

  const prisma = req.server.prisma;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ipAllowlist: true,
      ipAllowlistEnabled: true,
    },
  });

  if (!workspace || !workspace.ipAllowlistEnabled) return;

  const clientIP = getClientIP(req);
  if (!isIPAllowed(clientIP, workspace.ipAllowlist)) {
    reply.code(403);
    throw new Error("IP address not allowed");
  }
}
