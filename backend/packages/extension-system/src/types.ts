export type ExtensionType =
  | "agent"
  | "tool"
  | "model"
  | "mcp-server"
  | "execution-provider"
  | "deployment-provider"
  | "verification-provider"
  | "ui-panel"
  | "command"
  | "memory";

export type ExtensionLifecycleState = "registered" | "activating" | "active" | "deactivating" | "inactive" | "error";

export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  type: ExtensionType;
  capabilities: ExtensionCapabilities;
  permissions: ExtensionPermissions;
  dependencies?: ExtensionDependency[];
  minPlatformVersion: string;
  maxPlatformVersion?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

export interface ExtensionCapabilities {
  tools?: string[];
  agents?: string[];
  models?: string[];
  mcpServers?: string[];
  executionProviders?: string[];
  deploymentProviders?: string[];
  verificationProviders?: string[];
  uiPanels?: string[];
  commands?: string[];
}

export interface ExtensionPermissions {
  filesystem?: "none" | "read" | "write" | "admin";
  network?: "none" | "read" | "write" | "admin";
  database?: "none" | "read" | "write" | "admin";
  secrets?: "none" | "read" | "admin";
  git?: "none" | "read" | "write" | "admin";
  deployment?: "none" | "read" | "write" | "admin";
  mcp?: "none" | "read" | "write" | "admin";
  ui?: "none" | "read" | "write" | "admin";
}

export interface ExtensionDependency {
  name: string;
  version: string;
  optional?: boolean;
}

export interface ExtensionContext {
  workspaceId: string;
  projectId?: string;
  taskId?: string;
  userId: string;
  userRole: string;
}

export interface ExtensionHealth {
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastChecked: Date;
  error?: string;
  metrics?: Record<string, number>;
}

export interface Extension {
  manifest: ExtensionManifest;
  activate(context: ExtensionContext): Promise<void>;
  deactivate(): Promise<void>;
  healthCheck?(): Promise<ExtensionHealth>;
}

export interface ToolExtension extends Extension {
  manifest: ExtensionManifest & { type: "tool" };
  getToolDefinitions(): ToolDefinition[];
  executeTool(name: string, input: unknown, context: ExtensionContext): Promise<unknown>;
}

export interface AgentExtension extends Extension {
  manifest: ExtensionManifest & { type: "agent" };
  getAgentDefinition(): AgentDefinition;
  executeAgent(input: unknown, context: ExtensionContext): AsyncGenerator<unknown>;
}

export interface ModelExtension extends Extension {
  manifest: ExtensionManifest & { type: "model" };
  getModelProviders(): ModelProviderDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  inputSchema: Record<string, unknown>;
}

export interface AgentDefinition {
  role: string;
  name: string;
  description: string;
  capabilities: string[];
  allowedTools: string[];
}

export interface ModelProviderDefinition {
  type: string;
  name: string;
  models: string[];
}

export interface ExtensionState {
  manifest: ExtensionManifest;
  lifecycle: ExtensionLifecycleState;
  activatedAt?: Date;
  deactivatedAt?: Date;
  health: ExtensionHealth;
  error?: string;
}

export interface ExtensionRegistry {
  register(extension: Extension): void;
  unregister(name: string): void;
  getExtension(name: string): Extension | undefined;
  listExtensions(type?: ExtensionType): Extension[];
  activateAll(context: ExtensionContext): Promise<void>;
  deactivateAll(): Promise<void>;
  getState(name: string): ExtensionState | undefined;
  getHealth(name: string): ExtensionHealth | undefined;
}
