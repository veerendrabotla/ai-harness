import { z } from "zod";

// ── MCP servers ──────────────────────────────────────────────

export const createMcpServerRequestSchema = z.object({
  name: z.string().min(1).max(120),
  transportType: z.enum(["STDIO", "HTTP", "SSE"]),
  config: z.record(z.unknown()),
});
export type CreateMcpServerRequest = z.infer<typeof createMcpServerRequestSchema>;

export const updateMcpServerRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(["DISABLED", "ACTIVE"]).optional(),
  config: z.record(z.unknown()).optional(),
});
export type UpdateMcpServerRequest = z.infer<typeof updateMcpServerRequestSchema>;

export interface McpServerDto {
  id: string;
  ownerId: string;
  name: string;
  transportType: "STDIO" | "HTTP" | "SSE";
  status: "DISABLED" | "ACTIVE" | "ERROR";
  createdAt: string;
  updatedAt: string;
}

// ── Bridges ──────────────────────────────────────────────────

export interface BridgeDto {
  id: string;
  userId: string;
  name: string;
  version: string;
  status: "PENDING" | "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "REVOKED";
  capabilities: Record<string, unknown> | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface BridgeProjectRootDto {
  id: string;
  bridgeId: string;
  displayName: string;
  canonicalRootReference: string;
  createdAt: string;
}

export const registerBridgeProjectRootRequestSchema = z.object({
  displayName: z.string().min(1).max(160),
  canonicalRootReference: z.string().min(1).max(2000),
});
export type RegisterBridgeProjectRootRequest = z.infer<
  typeof registerBridgeProjectRootRequestSchema
>;
