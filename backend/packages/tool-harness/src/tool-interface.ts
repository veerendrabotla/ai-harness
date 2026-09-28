/**
 * Formal Tool interface for the AI Harness platform.
 * Every tool must implement this interface.
 */

export type ToolRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ToolIdentity {
  name: string;
  description: string;
  version: string;
  category: "filesystem" | "terminal" | "git" | "browser" | "database" | "package-manager" | "mcp" | "deployment" | "custom";
}

export interface ToolSchema {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface ToolPermissions {
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  workspaceRestrictions?: string[];
  projectRestrictions?: string[];
  allowedInSandbox: boolean;
  allowedInBridge: boolean;
  allowedInRemote: boolean;
}

export interface ToolAuditEvent {
  toolName: string;
  taskId: string;
  runId?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  riskLevel: ToolRiskLevel;
  approved: boolean;
  timestamp: Date;
}

export interface Tool {
  identity: ToolIdentity;
  schema: ToolSchema;
  permissions: ToolPermissions;
  validate(input: unknown): { valid: boolean; errors?: string[] };
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  taskId: string;
  runId?: string;
  projectId: string;
  workspaceId: string;
  workingDirectory: string;
  environment: "sandbox" | "bridge" | "remote";
  user?: { id: string; email: string };
}

export interface ToolResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  filesChanged?: string[];
  commandsRun?: string[];
  durationMs: number;
}

export interface ToolRegistryEntry {
  tool: Tool;
  registeredAt: Date;
  enabled: boolean;
}
