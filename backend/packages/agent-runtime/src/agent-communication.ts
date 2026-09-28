/**
 * Inter-Agent Communication System.
 * Provides controlled message passing and shared task context
 * between specialist agents.
 */
import { randomUUID } from "node:crypto";
import type { AgentRole, AgentMessage } from "@ai-harness/multi-agent";

export type MessageType =
  | "task_delegation"
  | "task_update"
  | "question"
  | "answer"
  | "observation"
  | "decision"
  | "artifact"
  | "blocker"
  | "escalation";

export interface SharedArtifact {
  id: string;
  type: "code" | "test" | "design" | "document" | "review" | "deployment";
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  createdBy: AgentRole;
  createdAt: Date;
}

export interface TaskContext {
  taskId: string;
  projectId: string;
  goal: string;
  constraints: string[];
  artifacts: SharedArtifact[];
  messages: AgentMessage[];
  decisions: Array<{
    agent: AgentRole;
    decision: string;
    reasoning: string;
    timestamp: Date;
  }>;
  blockers: Array<{
    id: string;
    agent: AgentRole;
    description: string;
    timestamp: Date;
    resolved: boolean;
  }>;
}

export interface AgentCommunicationChannel {
  /**
   * Send a message between agents.
   */
  sendMessage(message: Omit<AgentMessage, "id" | "timestamp">): Promise<AgentMessage>;

  /**
   * Get messages for a specific agent.
   */
  getMessagesForAgent(agent: AgentRole, taskId: string): Promise<AgentMessage[]>;

  /**
   * Get all messages for a task.
   */
  getTaskMessages(taskId: string): Promise<AgentMessage[]>;

  /**
   * Share an artifact between agents.
   */
  shareArtifact(artifact: Omit<SharedArtifact, "id" | "createdAt">): Promise<SharedArtifact>;

  /**
   * Get all artifacts for a task.
   */
  getTaskArtifacts(taskId: string): Promise<SharedArtifact[]>;

  /**
   * Record a decision.
   */
  recordDecision(agent: AgentRole, decision: string, reasoning: string, taskId: string): Promise<void>;

  /**
   * Get all decisions for a task.
   */
  getTaskDecisions(taskId: string): Promise<TaskContext["decisions"]>;

  /**
   * Report a blocker.
   */
  reportBlocker(agent: AgentRole, description: string, taskId: string): Promise<void>;

  /**
   * Resolve a blocker.
   */
  resolveBlocker(blockerId: string, taskId: string): Promise<void>;

  /**
   * Get task context.
   */
  getTaskContext(taskId: string): Promise<TaskContext>;
}

/**
 * In-memory implementation of agent communication.
 */
export class InMemoryAgentCommunication implements AgentCommunicationChannel {
  private messages = new Map<string, AgentMessage[]>();
  private artifacts = new Map<string, SharedArtifact[]>();
  private decisions = new Map<string, TaskContext["decisions"]>();
  private blockers = new Map<string, TaskContext["blockers"]>();

  async sendMessage(message: Omit<AgentMessage, "id" | "timestamp">): Promise<AgentMessage> {
    const fullMessage: AgentMessage = {
      ...message,
      id: randomUUID(),
      timestamp: new Date(),
    };

    const taskMessages = this.messages.get(message.metadata.taskId as string ?? "") ?? [];
    taskMessages.push(fullMessage);
    this.messages.set(message.metadata.taskId as string ?? "", taskMessages);

    return fullMessage;
  }

  async getMessagesForAgent(agent: AgentRole, taskId: string): Promise<AgentMessage[]> {
    const taskMessages = this.messages.get(taskId) ?? [];
    return taskMessages.filter(
      (m) => m.to === agent || m.from === agent,
    );
  }

  async getTaskMessages(taskId: string): Promise<AgentMessage[]> {
    return this.messages.get(taskId) ?? [];
  }

  async shareArtifact(artifact: Omit<SharedArtifact, "id" | "createdAt">): Promise<SharedArtifact> {
    const fullArtifact: SharedArtifact = {
      ...artifact,
      id: randomUUID(),
      createdAt: new Date(),
    };

    const taskArtifacts = this.artifacts.get(artifact.metadata.taskId as string ?? "") ?? [];
    taskArtifacts.push(fullArtifact);
    this.artifacts.set(artifact.metadata.taskId as string ?? "", taskArtifacts);

    return fullArtifact;
  }

  async getTaskArtifacts(taskId: string): Promise<SharedArtifact[]> {
    return this.artifacts.get(taskId) ?? [];
  }

  async recordDecision(agent: AgentRole, decision: string, reasoning: string, taskId: string): Promise<void> {
    const taskDecisions = this.decisions.get(taskId) ?? [];
    taskDecisions.push({
      agent,
      decision,
      reasoning,
      timestamp: new Date(),
    });
    this.decisions.set(taskId, taskDecisions);
  }

  async getTaskDecisions(taskId: string): Promise<TaskContext["decisions"]> {
    return this.decisions.get(taskId) ?? [];
  }

  async reportBlocker(agent: AgentRole, description: string, taskId: string): Promise<void> {
    const taskBlockers = this.blockers.get(taskId) ?? [];
    taskBlockers.push({
      id: randomUUID(),
      agent,
      description,
      timestamp: new Date(),
      resolved: false,
    });
    this.blockers.set(taskId, taskBlockers);
  }

  async resolveBlocker(blockerId: string, taskId: string): Promise<void> {
    const taskBlockers = this.blockers.get(taskId) ?? [];
    const blocker = taskBlockers.find((b) => b.id === blockerId);
    if (blocker) {
      blocker.resolved = true;
    }
  }

  async getTaskContext(taskId: string): Promise<TaskContext> {
    return {
      taskId,
      projectId: "",
      goal: "",
      constraints: [],
      artifacts: this.artifacts.get(taskId) ?? [],
      messages: this.messages.get(taskId) ?? [],
      decisions: this.decisions.get(taskId) ?? [],
      blockers: this.blockers.get(taskId) ?? [],
    };
  }
}
