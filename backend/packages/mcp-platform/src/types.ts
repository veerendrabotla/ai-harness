export type MCPTransportType = "STDIO" | "SSE" | "STREAMABLE_HTTP";

export enum TransportType {
  STDIO = "STDIO",
  SSE = "SSE",
  STREAMABLE_HTTP = "STREAMABLE_HTTP",
}

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  autoApprove?: string[];
  timeout?: number;
  disabled?: boolean;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: "stdio" | "sse" | "streamable-http";
  transportType?: MCPTransportType | TransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  autoApprove?: string[];
  timeout?: number;
  disabled?: boolean;
  url?: string;
  apiKey?: string;
  workspaceId?: string;
  projectId?: string;
  enabled: boolean;
  retryPolicy?: MCPRetryPolicy;
  permissions?: MCPServerPermissions;
  createdAt: Date;
  updatedAt: Date;
}

export interface MCPRetryPolicy {
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs: number;
}

export interface MCPServerPermissions {
  tools: "none" | "read" | "write" | "admin";
  resources: "none" | "read" | "write" | "admin";
  prompts: "none" | "read" | "admin";
}

export type MCPServerStatus = "disconnected" | "connecting" | "connected" | "error" | "disabled";

export interface MCPServerState {
  id: string;
  config: MCPServerConfig;
  status: MCPServerStatus;
  connectedAt?: Date;
  lastError?: string;
  reconnectCount: number;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  health: MCPHealthStatus;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: MCPToolAnnotations;
}

export interface MCPToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPHealthStatus {
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  latencyMs?: number;
  lastChecked: Date;
  error?: string;
}

export interface MCPConnection {
  serverId: string;
  status: MCPServerStatus;
  capabilities: MCPCapabilities;
  serverInfo?: MCPServerInfo;
}

export interface MCPCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
}

export interface MCPServerInfo {
  name: string;
  version?: string;
}

export interface MCPToolCallResult {
  content: MCPContent[];
  isError?: boolean;
}

export interface MCPContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri: string; text?: string; blob?: string };
}

export interface MCPResourceContent {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

export interface MCPPromptResult {
  description?: string;
  messages: MCPMessage[];
}

export interface MCPMessage {
  role: "user" | "assistant";
  content: MCPContent;
}

export interface MCPWorkspaceConfig {
  workspaceId: string;
  servers: MCPServerConfig[];
  globalPermissions: MCPServerPermissions;
}

export interface MCPProjectConfig {
  projectId: string;
  workspaceId: string;
  servers: MCPServerConfig[];
}

export interface MCPAuditEvent {
  id: string;
  serverId: string;
  action: "connect" | "disconnect" | "tool_call" | "resource_read" | "prompt_get" | "error";
  details: Record<string, unknown>;
  timestamp: Date;
  userId?: string;
  workspaceId?: string;
  projectId?: string;
}

export const DEFAULT_RETRY_POLICY: MCPRetryPolicy = {
  maxRetries: 3,
  backoffMs: 1000,
  maxBackoffMs: 30_000,
};

export const DEFAULT_PERMISSIONS: MCPServerPermissions = {
  tools: "read",
  resources: "read",
  prompts: "read",
};
