/**
 * Supervisor Agent.
 * Coordinates all specialist agents, makes high-level decisions,
 * and delegates tasks to the appropriate agents.
 */
import { randomUUID } from "node:crypto";
import { BaseAgent } from "./base-agent.js";
import type { Agent, AgentRole, AgentMessage, AgentTask, SupervisorConfig, SupervisorDecision, TaskAssignment } from "./types.js";

export class SupervisorAgent extends BaseAgent {
  private agents: Map<AgentRole, Agent> = new Map();
  private config: SupervisorConfig;
  private taskQueue: TaskAssignment[] = [];

  constructor(config: SupervisorConfig = {
    maxConcurrentAgents: 3,
    taskTimeout: 300_000,
    allowDelegation: true,
  }) {
    super("supervisor", "Supervisor", "Coordinates all specialist agents");
    this.config = config;
  }

  /**
   * Enforce WorkspacePolicy.maxSubagents on this supervisor.
   * If maxSubagents is 0, multi-agent is disabled (maxConcurrentAgents = 0, allowDelegation = false).
   * Otherwise clamp maxConcurrentAgents to the policy limit.
   */
  applyPolicyLimits(maxSubagents: number): void {
    if (maxSubagents === 0) {
      this.config.maxConcurrentAgents = 0;
      this.config.allowDelegation = false;
      return;
    }
    if (maxSubagents > 0) {
      this.config.maxConcurrentAgents = Math.min(this.config.maxConcurrentAgents, maxSubagents);
    }
  }

  /** Whether multi-agent delegation is enabled under the current policy. */
  isMultiAgentEnabled(): boolean {
    return this.config.allowDelegation && this.config.maxConcurrentAgents > 0;
  }

  getMaxConcurrentAgents(): number {
    return this.config.maxConcurrentAgents;
  }

  /**
   * Register a specialist agent.
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.role, agent);
  }

  /**
   * Execute a high-level task by breaking it down and delegating.
   * Respects WorkspacePolicy.maxSubagents via config.maxConcurrentAgents.
   * When maxConcurrentAgents is 0 (maxSubagents=0) the supervisor short-circuits
   * and returns the task without delegation — multi-agent disabled by policy.
   */
  async execute(task: AgentTask): Promise<AgentTask> {
    if (!this.isMultiAgentEnabled()) {
      this.startTask(task);
      return this.completeTask({ disabledByPolicy: true, reason: "maxSubagents=0 — multi-agent disabled" });
    }
    this.startTask(task);

    try {
      // Step 1: Analyze the task
      const analysis = this.analyzeTask(task);

      // Step 2: Create assignments
      const assignments = this.createAssignments(task, analysis);

      // Step 3: Execute assignments respecting dependencies with bounded parallelism
      const results: Record<string, unknown> = {};
      const executed = new Set<string>();
      const remaining = [...assignments];

      while (remaining.length > 0) {
        // Find assignments whose dependencies are already satisfied
        const ready = remaining.filter((a) => a.task.dependencies.every((dep) => executed.has(dep)));
        // Fallback for circular/missing deps: take one to avoid deadlock
        const batchCandidates = ready.length > 0 ? ready : [remaining[0]!];
        const batch = batchCandidates.slice(0, this.config.maxConcurrentAgents);

        // Remove batch from remaining
        for (const b of batch) {
          const idx = remaining.indexOf(b);
          if (idx !== -1) remaining.splice(idx, 1);
        }

        const batchResults = await Promise.all(
          batch.map(async (assignment) => {
            const agent = this.agents.get(assignment.agent);
            if (!agent) {
              return {
                agent: assignment.agent,
                error: `Agent ${assignment.agent} not available` as const,
                assignment,
              };
            }
            const subtask: AgentTask = {
              id: assignment.task.id,
              role: assignment.agent,
              description: assignment.task.description,
              input: assignment.task.input,
              output: null,
              status: "pending",
              parentId: task.id,
              dependencies: assignment.task.dependencies,
            };
            const completedTask = await agent.execute(subtask);
            return { agent: assignment.agent, output: completedTask.output as unknown, assignment };
          }),
        );

        for (const res of batchResults) {
          if ("error" in res) {
            results[`${res.agent}_error`] = res.error;
          } else {
            results[res.agent] = res.output;
          }
          executed.add(res.assignment.task.id);
        }
      }

      return this.completeTask(results);
    } catch (error) {
      return this.failTask(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle a message from a specialist agent.
   */
  override async handleMessage(message: AgentMessage): Promise<AgentMessage> {
    this.history.push(message);

    switch (message.type) {
      case "observation":
        return this.handleObservation(message);
      case "request":
        return this.handleRequest(message);
      case "response":
        return this.handleResponse(message);
      default:
        return this.createMessage(message.from, "response", "Acknowledged");
    }
  }

  /**
   * Analyze a task and determine the best approach.
   */
  private analyzeTask(task: AgentTask): {
    requiredAgents: AgentRole[];
    complexity: "simple" | "moderate" | "complex";
    estimatedSteps: number;
  } {
    const description = task.description.toLowerCase();

    const requiredAgents: AgentRole[] = [];
    let complexity: "simple" | "moderate" | "complex" = "simple";

    // Determine required agents based on task description
    if (description.includes("plan") || description.includes("design") || description.includes("architect")) {
      requiredAgents.push("planner");
    }
    if (description.includes("code") || description.includes("implement") || description.includes("write") || description.includes("create")) {
      requiredAgents.push("coder");
    }
    if (description.includes("review") || description.includes("check") || description.includes("audit")) {
      requiredAgents.push("reviewer");
    }
    if (description.includes("test") || description.includes("verify") || description.includes("validate")) {
      requiredAgents.push("tester");
    }
    if (description.includes("deploy") || description.includes("build") || description.includes("release")) {
      requiredAgents.push("devops");
    }

    // Default to coder if no specific agent identified
    if (requiredAgents.length === 0) {
      requiredAgents.push("coder");
    }

    // Determine complexity
    if (requiredAgents.length > 2 || description.includes("complex") || description.includes("full")) {
      complexity = "complex";
    } else if (requiredAgents.length > 1) {
      complexity = "moderate";
    }

    return {
      requiredAgents,
      complexity,
      estimatedSteps: requiredAgents.length * 2,
    };
  }

  /**
   * Create task assignments based on analysis.
   * Only planner is a true dependency: if planner is included it must finish
   * first (other agents consume its plan). All non-planner specialists are
   * independent and can run in parallel once the planner dependency is satisfied.
   */
  private createAssignments(task: AgentTask, analysis: {
    requiredAgents: AgentRole[];
    complexity: string;
  }): TaskAssignment[] {
    const assignments: TaskAssignment[] = [];

    const hasPlanner = analysis.requiredAgents.includes("planner");
    let plannerTaskId: string | null = null;

    for (let i = 0; i < analysis.requiredAgents.length; i++) {
      const role = analysis.requiredAgents[i]!;
      const taskId = randomUUID();
      const dependencies: string[] = [];
      if (role !== "planner" && hasPlanner) {
        // Ensure planner task id is known: planner is expected first in requiredAgents
        if (plannerTaskId) {
          dependencies.push(plannerTaskId);
        } else {
          // Fallback: find planner assignment already created
          const plannerAssignment = assignments.find((a) => a.agent === "planner");
          if (plannerAssignment) dependencies.push(plannerAssignment.task.id);
        }
      }
      // Non-planner tasks have no inter-dependencies — they can run in parallel

      assignments.push({
        agent: role,
        task: {
          id: taskId,
          role,
          description: task.description,
          input: task.input,
          output: null,
          status: "pending",
          dependencies,
        },
        priority: i + 1,
        reason: `Assigned based on task analysis`,
      });

      if (role === "planner") plannerTaskId = taskId;
    }

    return assignments;
  }

  /**
   * Handle an observation from a specialist agent.
   * Observations are status updates or findings that may require plan adjustments.
   */
  private handleObservation(message: AgentMessage): AgentMessage {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);

    // Check if observation indicates a blocker or issue that needs re-planning
    const isBlocker = /blocked|error|failed|cannot|unable|missing/i.test(content);
    if (isBlocker) {
      // Re-analyze and potentially re-assign tasks
      this.taskQueue = this.taskQueue.filter((a) => a.agent !== message.from);
    }

    return this.createMessage(message.from, "response", JSON.stringify({
      acknowledged: true,
      action: isBlocker ? "replan" : "logged",
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Handle a request from a specialist agent.
   * Requests are needs for information, resources, or clarification.
   */
  private handleRequest(message: AgentMessage): AgentMessage {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);

    // Extract request type from content
    const requestMatch = content.match(/^(get|need|require|fetch|list|show)\s+(.+)/i);
    const requestType = requestMatch?.[1]?.toLowerCase() ?? "unknown";
    const target = requestMatch?.[2] ?? content;

    let response: Record<string, unknown>;
    switch (requestType) {
      case "get":
      case "fetch":
        // Provide available context about the target
        response = { data: `Information about "${target}" retrieved from supervisor context`, available: true };
        break;
      case "list":
        // List available agents and their statuses
        response = { agents: this.getAllAgentStatuses(), queue: this.taskQueue.length };
        break;
      case "need":
      case "require":
        // Acknowledge need and note it for next planning cycle
        response = { acknowledged: true, note: `Need for "${target}" recorded for next planning cycle` };
        break;
      default:
        response = { processed: true, message: `Request "${requestType}" for "${target}" acknowledged` };
    }

    return this.createMessage(message.from, "response", JSON.stringify(response));
  }

  /**
   * Handle a response from a specialist agent.
   * Responses are results or outputs from completed sub-tasks.
   */
  private handleResponse(message: AgentMessage): AgentMessage {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);

    // Check if the response indicates task completion or failure
    const isFailure = /error|failed|exception|crashed/i.test(content);
    const isComplete = /completed|done|finished|success/i.test(content);

    // Update task queue - remove completed assignments for this agent
    if (isComplete || isFailure) {
      this.taskQueue = this.taskQueue.filter((a) => a.agent !== message.from);
    }

    return this.createMessage(message.from, "observation", JSON.stringify({
      received: true,
      status: isFailure ? "failure_noted" : isComplete ? "completion_noted" : "acknowledged",
      queueDepth: this.taskQueue.length,
    }));
  }

  /**
   * Make a decision about task delegation.
   */
  makeDecision(task: AgentTask): SupervisorDecision {
    const analysis = this.analyzeTask(task);

    if (analysis.requiredAgents.length === 1) {
      return {
        type: "delegate",
        target: analysis.requiredAgents[0],
        reasoning: `Single specialist task for ${analysis.requiredAgents[0]}`,
        confidence: 0.9,
      };
    }

    if (analysis.complexity === "complex") {
      return {
        type: "delegate",
        target: "planner",
        reasoning: "Complex task requires planning first",
        confidence: 0.85,
      };
    }

    return {
      type: "delegate",
      target: analysis.requiredAgents[0],
      reasoning: `Starting with ${analysis.requiredAgents[0]}`,
      confidence: 0.8,
    };
  }

  /**
   * Get all agent statuses.
   */
  getAllAgentStatuses(): Array<{
    role: AgentRole;
    status: string;
    currentTask: string | null;
  }> {
    return Array.from(this.agents.values()).map((agent) => ({
      role: agent.role,
      status: agent.getStatus().status,
      currentTask: agent.getStatus().currentTask,
    }));
  }
}
