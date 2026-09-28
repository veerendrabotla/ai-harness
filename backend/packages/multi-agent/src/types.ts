/**
 * Multi-Agent Architecture Types.
 * Supervisor → Specialist agents (Planner, Coder, Reviewer, Tester, DevOps)
 *
 * This is one of the real differentiators:
 * - Supervisor: coordinates all agents, makes high-level decisions
 * - Planner: breaks down goals into actionable steps
 * - Coder: writes and modifies code
 * - Reviewer: reviews code quality, security, patterns
 * - Tester: writes and runs tests
 * - DevOps: handles deployment, infrastructure
 */

export type AgentRole =
  | "supervisor"
  | "planner"
  | "coder"
  | "reviewer"
  | "tester"
  | "devops";

export type AgentStatus = "idle" | "thinking" | "executing" | "waiting" | "error";

export interface AgentMessage {
  id: string;
  from: AgentRole;
  to: AgentRole;
  type: "request" | "response" | "delegation" | "observation" | "decision";
  content: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface AgentTask {
  id: string;
  role: AgentRole;
  description: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  parentId?: string; // for delegated subtasks
  dependencies: string[]; // task IDs that must complete first
  startedAt?: Date;
  completedAt?: Date;
}

export interface Agent {
  readonly role: AgentRole;
  readonly name: string;
  readonly description: string;
  status: AgentStatus;
  capabilities: string[];
  currentTask: AgentTask | null;
  history: AgentMessage[];

  /**
   * Execute a task.
   */
  execute(task: AgentTask): Promise<AgentTask>;

  /**
   * Handle a message from another agent.
   */
  handleMessage(message: AgentMessage): Promise<AgentMessage>;

  /**
   * Get agent status.
   */
  getStatus(): {
    role: AgentRole;
    status: AgentStatus;
    currentTask: string | null;
    completedTasks: number;
  };
}

export interface SupervisorConfig {
  maxConcurrentAgents: number;
  taskTimeout: number;
  allowDelegation: boolean;
}

export interface TaskAssignment {
  agent: AgentRole;
  task: AgentTask;
  priority: number;
  reason: string;
}

export interface SupervisorDecision {
  type: "delegate" | "execute_directly" | "escalate" | "abort";
  target?: AgentRole;
  reasoning: string;
  confidence: number;
}
