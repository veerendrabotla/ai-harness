/**
 * Formal Agent interface for the AI Harness platform.
 * All agents must implement this interface.
 */
export interface AgentIdentity {
  role: FormalAgentRole;
  name: string;
  description: string;
  version: string;
}

export type FormalAgentRole = "SUPERVISOR" | "PLANNER" | "CODER" | "REVIEWER" | "TESTER" | "DEVOPS";

export interface AgentCapabilities {
  canReadFiles: boolean;
  canWriteFiles: boolean;
  canExecuteCommands: boolean;
  canAccessNetwork: boolean;
  canDeploy: boolean;
  canRunTests: boolean;
  maxTokens: number;
  supportedModels: string[];
}

export interface AgentPermissions {
  allowedTools: string[];
  deniedTools: string[];
  requiresApproval: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface AgentContext {
  taskId: string;
  runId: string;
  projectId: string;
  workspaceId: string;
  goal: string;
  plan?: AgentPlan;
  previousRuns: AgentRunSummary[];
  memories: AgentMemory[];
  projectAnalysis: Record<string, unknown>;
}

export interface AgentPlan {
  id: string;
  steps: AgentPlanStep[];
}

export interface AgentPlanStep {
  id: string;
  description: string;
  toolName?: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED";
}

export interface AgentRunSummary {
  id: string;
  state: string;
  outcome?: string;
  summary?: string;
  toolCalls: number;
  duration: number;
}

export interface AgentMemory {
  id: string;
  category: string;
  content: string;
  confidence: number;
}

export interface AgentResult {
  status: "SUCCESS" | "FAILURE" | "PARTIAL" | "NEEDS_APPROVAL";
  output: string;
  filesChanged: string[];
  testsRun: boolean;
  testsPassed?: boolean;
  commitSha?: string;
  summary: string;
  nextSteps?: string[];
}

export interface FormalAgent {
  identity: AgentIdentity;
  capabilities: AgentCapabilities;
  permissions: AgentPermissions;

  /**
   * Execute the agent's task.
   * Returns an async generator of events for streaming.
   */
  execute(context: AgentContext): AsyncGenerator<AgentEvent, AgentResult>;

  /**
   * Validate whether this agent can handle the given task.
   */
  canHandle(context: AgentContext): boolean;
}

export interface AgentEvent {
  type: "thinking" | "reasoning" | "tool_call" | "tool_result" | "observation" | "decision" | "communication";
  timestamp: Date;
  data: Record<string, unknown>;
}
