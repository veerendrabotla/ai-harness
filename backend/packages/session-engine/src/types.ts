export type SessionStatus = "active" | "paused" | "archived" | "deleted";

export interface Session {
  id: string;
  name: string;
  projectId: string;
  workspaceId: string;
  status: SessionStatus;
  conversation: ConversationMessage[];
  toolCalls: ToolCallRecord[];
  plans: PlanRecord[];
  approvals: ApprovalRecord[];
  filesChanged: string[];
  checkpoints: string[];
  modelInfo: ModelInfo;
  executionProvider: string;
  agentState: AgentState;
  verification: VerificationState;
  deployment?: DeploymentState;
  memoryReferences: string[];
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
  forkedFrom?: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  duration: number;
  timestamp: Date;
}

export interface PlanRecord {
  id: string;
  content: string;
  approved: boolean;
  approvedBy?: string;
  timestamp: Date;
}

export interface ApprovalRecord {
  id: string;
  type: string;
  approved: boolean;
  approvedBy?: string;
  timestamp: Date;
}

export interface ModelInfo {
  provider: string;
  model: string;
  tokensUsed: number;
}

export interface AgentState {
  mode: string;
  phase: string;
  iteration: number;
}

export interface VerificationState {
  lastVerified?: Date;
  passed: boolean;
  tests: string[];
}

export interface DeploymentState {
  provider: string;
  url?: string;
  status: string;
  deployedAt?: Date;
}

export interface SessionForkResult {
  originalSessionId: string;
  newSessionId: string;
  forkPoint: number;
}
