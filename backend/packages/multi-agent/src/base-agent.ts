/**
 * Base Agent.
 * Provides common functionality for all specialist agents.
 */
import { randomUUID } from "node:crypto";
import type { Agent, AgentRole, AgentStatus, AgentMessage, AgentTask } from "./types.js";

export abstract class BaseAgent implements Agent {
  readonly role: AgentRole;
  readonly name: string;
  readonly description: string;
  status: AgentStatus = "idle";
  capabilities: string[] = [];
  currentTask: AgentTask | null = null;
  history: AgentMessage[] = [];

  constructor(role: AgentRole, name: string, description: string) {
    this.role = role;
    this.name = name;
    this.description = description;
  }

  abstract execute(task: AgentTask): Promise<AgentTask>;

  async handleMessage(message: AgentMessage): Promise<AgentMessage> {
    this.history.push(message);

    // Default: acknowledge receipt
    return {
      id: randomUUID(),
      from: this.role,
      to: message.from,
      type: "response",
      content: `Received: ${message.content}`,
      metadata: {},
      timestamp: new Date(),
    };
  }

  getStatus(): {
    role: AgentRole;
    status: AgentStatus;
    currentTask: string | null;
    completedTasks: number;
  } {
    return {
      role: this.role,
      status: this.status,
      currentTask: this.currentTask?.id ?? null,
      completedTasks: this.history.filter((m) => m.type === "response").length,
    };
  }

  /**
   * Send a message to another agent.
   */
  protected createMessage(
    to: AgentRole,
    type: AgentMessage["type"],
    content: string,
    metadata: Record<string, unknown> = {},
  ): AgentMessage {
    return {
      id: randomUUID(),
      from: this.role,
      to,
      type,
      content,
      metadata,
      timestamp: new Date(),
    };
  }

  /**
   * Mark task as started.
   */
  protected startTask(task: AgentTask): void {
    this.currentTask = { ...task, status: "in_progress", startedAt: new Date() };
    this.status = "executing";
  }

  /**
   * Mark task as completed.
   */
  protected completeTask(output: Record<string, unknown>): AgentTask {
    if (!this.currentTask) throw new Error("No current task");
    const completed = {
      ...this.currentTask,
      status: "completed" as const,
      output,
      completedAt: new Date(),
    };
    this.currentTask = null;
    this.status = "idle";
    return completed;
  }

  /**
   * Mark task as failed.
   */
  protected failTask(error: string): AgentTask {
    if (!this.currentTask) throw new Error("No current task");
    const failed = {
      ...this.currentTask,
      status: "failed" as const,
      output: { error },
      completedAt: new Date(),
    };
    this.currentTask = null;
    this.status = "error";
    return failed;
  }
}
