export type AgentStatus = "online" | "offline" | "busy" | "error";

export interface AgentRegistration {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  capabilities: AgentCapability[];
  metadata: Record<string, unknown>;
  registeredAt: Date;
  lastHeartbeat: Date;
}

export interface AgentCapability {
  name: string;
  description: string;
  version: string;
}

export interface AgentHealth {
  agentId: string;
  status: AgentStatus;
  uptime: number;
  tasksCompleted: number;
  lastError?: string;
}
