/**
 * Multi-Agent Orchestrator Wrapper.
 * Wraps the core TaskOrchestrator to use the Supervisor agent
 * for intelligent task delegation to specialist agents.
 *
 * Specialist agents make independent LLM calls to produce role-specific
 * context (plans, reviews, test strategies) that enriches the orchestrator's
 * execution constraints.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@ai-harness/shared";
import { SupervisorAgent, PlannerAgent, CoderAgent, ReviewerAgent, TesterAgent, DevOpsAgent } from "@ai-harness/multi-agent";
import type { AgentRole, AgentTask, SupervisorDecision } from "@ai-harness/multi-agent";
import type { ModelAdapterRegistry, ModelRequest } from "@ai-harness/model-adapters";
import type { ModelRouter } from "./model-router.js";
import type { TaskOrchestrator, RunOutcome } from "./orchestrator.js";
import { EventPublisher } from "./event-publisher.js";
import type { RunInput } from "./run-input.js";
import type { AgentCommunicationChannel } from "./agent-communication.js";

interface AgentDelegation {
  supervisorDecision: SupervisorDecision;
  assignedAgents: AgentRole[];
  taskAssignments: Array<{
    agent: AgentRole;
    taskDescription: string;
    priority: number;
  }>;
}

interface SpecialistContext {
  agent: AgentRole;
  output: string;
  confidence: number;
}

/**
 * Multi-agent orchestrator that uses Supervisor to delegate tasks
 * to specialist agents. Each specialist makes an LLM call with a
 * role-specific prompt, producing structured context that enriches
 * the orchestrator's execution.
 */
export class MultiAgentOrchestrator {
  private supervisor: SupervisorAgent;

  constructor(
    private readonly orchestrator: TaskOrchestrator,
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly events: EventPublisher,
    private readonly adapters?: ModelAdapterRegistry,
    private readonly router?: ModelRouter,
    private readonly communication?: AgentCommunicationChannel,
  ) {
    this.supervisor = new SupervisorAgent({
      maxConcurrentAgents: 3,
      taskTimeout: 300_000,
      allowDelegation: true,
    });

    this.supervisor.registerAgent(new PlannerAgent());
    this.supervisor.registerAgent(new CoderAgent());
    this.supervisor.registerAgent(new ReviewerAgent());
    this.supervisor.registerAgent(new TesterAgent());
    this.supervisor.registerAgent(new DevOpsAgent());
  }

  /**
   * Resolve WorkspacePolicy.maxSubagents for the given workspace.
   * Returns null when no policy row exists (use default).
   */
  private async resolveMaxSubagents(workspaceId: string): Promise<number | null> {
    try {
      const policy = await this.prisma.workspacePolicy.findUnique({
        where: { workspaceId },
        select: { maxSubagents: true },
      });
      return policy ? policy.maxSubagents : null;
    } catch {
      return null;
    }
  }

  /**
   * Start a run with multi-agent delegation.
   * Enforces WorkspacePolicy.maxSubagents: caps maxConcurrentAgents and
   * disables multi-agent entirely when maxSubagents is 0.
   * Specialist agents produce context that enriches the execution constraints.
   */
  async startRun(input: RunInput): Promise<RunOutcome> {
    // Enforce maxSubagents from workspace policy
    const maxSubagents = await this.resolveMaxSubagents(input.workspaceId);
    if (maxSubagents !== null) {
      this.supervisor.applyPolicyLimits(maxSubagents);
      if (!this.supervisor.isMultiAgentEnabled()) {
        this.logger.info({ taskId: input.taskId, workspaceId: input.workspaceId }, "multi-agent disabled by policy (maxSubagents=0), falling back to single-agent");
        return this.orchestrator.startRun(input);
      }
    }

    const delegation = this.analyzeAndDelegate(input, maxSubagents);

    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: input.runId || null,
      eventType: "AGENT_DELEGATION_DECIDED",
      actorType: "SYSTEM",
      payload: {
        decision: delegation.supervisorDecision,
        assignedAgents: delegation.assignedAgents,
        taskCount: delegation.taskAssignments.length,
      },
    });

    // Produce specialist context via LLM calls
    const specialistContexts = await this.produceSpecialistContext(input, delegation);

    // Emit each specialist result as a trace event
    for (const ctx of specialistContexts) {
      await this.events.publishAndEmit({
        taskId: input.taskId,
        runId: input.runId || null,
        eventType: "AGENT_TASK_CREATED",
        actorType: "SYSTEM",
        payload: {
          agentRole: ctx.agent,
          outputLength: ctx.output.length,
          confidence: ctx.confidence,
        },
      });

      // Share specialist output as an artifact via the communication channel
      if (this.communication) {
        try {
          await this.communication.shareArtifact({
            type: "document",
            name: `${ctx.agent}-analysis`,
            content: ctx.output,
            metadata: { taskId: input.taskId, confidence: ctx.confidence },
            createdBy: ctx.agent,
          });
        } catch (err) {
          this.logger.warn({ err, agent: ctx.agent }, "Failed to share specialist artifact");
        }
      }
    }

    // Enrich input with specialist context
    const enrichedInput = this.enrichInputWithContext(input, specialistContexts);

    // Execute with enriched context
    const outcome = await this.orchestrator.startRun(enrichedInput);

    // Record agent delegation results
    await this.recordAgentResults(input, delegation, outcome, specialistContexts);

    return outcome;
  }

  /**
   * Produce specialist context by making LLM calls with role-specific prompts.
   * Independent specialists are called in parallel with bounded concurrency
   * (maxConcurrentAgents). Only planner is treated as a pre-dependency if
   * present — it runs first and its output is not required for other specialists
   * (all prompts use the same input goal), so we can still parallelize all.
   */
  private async produceSpecialistContext(
    input: RunInput,
    delegation: AgentDelegation,
  ): Promise<SpecialistContext[]> {
    if (!this.adapters || !this.router) {
      this.logger.debug("No adapters/router available; skipping specialist LLM calls");
      return [];
    }

    // Respect WorkspacePolicy.maxSubagents as maxConcurrentAgents
    const maxConcurrent = this.supervisor.isMultiAgentEnabled() ? this.supervisor.getMaxConcurrentAgents() : 3;
    const contexts: SpecialistContext[] = [];

    // Chunk assignments to respect concurrency limit and run each chunk in parallel
    const chunks: Array<typeof delegation.taskAssignments> = [];
    for (let i = 0; i < delegation.taskAssignments.length; i += maxConcurrent) {
      chunks.push(delegation.taskAssignments.slice(i, i + maxConcurrent));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (assignment) => {
          try {
            const output = await this.callLLMForSpecialist(assignment.agent, input);
            return { agent: assignment.agent, output, confidence: 0.8 as const, ok: true as const };
          } catch (error) {
            this.logger.warn(
              { err: error, agent: assignment.agent, taskId: input.taskId },
              "Specialist LLM call failed, skipping",
            );
            return { agent: assignment.agent, output: "", confidence: 0, ok: false as const };
          }
        }),
      );
      for (const r of chunkResults) {
        if (r.ok) contexts.push({ agent: r.agent, output: r.output, confidence: r.confidence });
      }
    }

    return contexts;
  }

  /**
   * Call the LLM with a role-specific prompt for a specialist agent.
   */
  private async callLLMForSpecialist(agent: AgentRole, input: RunInput): Promise<string> {
    const prompts: Record<AgentRole, string> = {
      planner: `You are a software planning specialist. Analyze this task and produce a structured plan.

TASK: ${input.goal}
${input.constraints ? `CONSTRAINTS: ${input.constraints}` : ""}

Produce a JSON plan with:
- "steps": array of step objects with "description", "files" (affected files), "risk" (low/medium/high)
- "dependencies": external packages or services needed
- "estimatedComplexity": simple/moderate/complex
- "recommendations": array of recommendations

Return ONLY valid JSON, no markdown.`,

      coder: `You are a senior software engineer. Analyze this task and produce implementation guidance.

TASK: ${input.goal}
${input.constraints ? `CONSTRAINTS: ${input.constraints}` : ""}

Produce a JSON object with:
- "approach": the recommended implementation approach
- "filesToCreate": files that should be created (with brief description)
- "filesToModify": files that should be modified (with what changes)
- "keyPatterns": coding patterns or conventions to follow
- "potentialIssues": things to watch out for

Return ONLY valid JSON, no markdown.`,

      reviewer: `You are a code reviewer. Analyze this task and produce review criteria.

TASK: ${input.goal}
${input.constraints ? `CONSTRAINTS: ${input.constraints}` : ""}

Produce a JSON object with:
- "reviewFocus": areas to pay special attention to
- "commonMistakes": typical mistakes for this type of task
- "qualityCriteria": criteria that must be met
- "suggestions": actionable suggestions

Return ONLY valid JSON, no markdown.`,

      tester: `You are a QA engineer. Analyze this task and produce a test strategy.

TASK: ${input.goal}
${input.constraints ? `CONSTRAINTS: ${input.constraints}` : ""}

Produce a JSON object with:
- "testTypes": types of tests needed (unit, integration, e2e)
- "testScenarios": key scenarios to test
- "edgeCases": edge cases to consider
- "verificationCommands": commands to verify the implementation

Return ONLY valid JSON, no markdown.`,

      devops: `You are a DevOps engineer. Analyze this task and produce deployment considerations.

TASK: ${input.goal}
${input.constraints ? `CONSTRAINTS: ${input.constraints}` : ""}

Produce a JSON object with:
- "deploymentImpact": how this change affects deployment
- "rollbackPlan": how to roll back if something goes wrong
- "monitoring": what to monitor after deployment
- "environmentVariables": any env vars that might be needed

Return ONLY valid JSON, no markdown.`,

      supervisor: `You are a supervisor coordinating a software engineering task.

TASK: ${input.goal}
${input.constraints ? `CONSTRAINTS: ${input.constraints}` : ""}

Produce a JSON object with:
- "overallStrategy": the recommended approach
- "riskAssessment": risk level and mitigation
- "coordinationPlan": how agents should work together

Return ONLY valid JSON, no markdown.`,
    };

    const prompt = prompts[agent] ?? prompts.coder;

    const route = await this.router!.resolve({
      userId: input.userId,
      workspaceId: input.workspaceId,
      stage: "IMPLEMENTATION",
      override: input.modelOverride ?? undefined,
    });

    const adapter = this.adapters!.require(route.providerConnection.providerType);

    const request: ModelRequest = {
      stage: "IMPLEMENTATION",
      modelIdentifier: route.modelIdentifier,
      systemInstructions: "You are a specialist software engineering assistant. Return only valid JSON.",
      userObjective: prompt,
      contextItems: "",
      responseSchemaName: "FREEFORM",
      maxOutputTokens: 1500,
    };

    const response = await adapter.generate(request, route.providerConnection);
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: input.runId || null,
      eventType: "MODEL_INVOCATION_RECORDED",
      actorType: "AGENT",
      payload: {
        stage: "IMPLEMENTATION",
        providerType: route.providerConnection.providerType,
        modelIdentifier: route.modelIdentifier,
        finishReason: response.finishReason,
        usage: response.usage,
      },
    });
    return response.text;
  }

  /**
   * Enrich input with specialist context as additional constraints.
   */
  private enrichInputWithContext(input: RunInput, contexts: SpecialistContext[]): RunInput {
    if (contexts.length === 0) return input;

    const contextParts: string[] = [];

    for (const ctx of contexts) {
      contextParts.push(`[${ctx.agent.toUpperCase()} CONTEXT]\n${ctx.output}`);
    }

    const contextStr = contextParts.join("\n\n");

    return {
      ...input,
      constraints: input.constraints
        ? `${input.constraints}\n\nSPECIALIST ANALYSIS:\n${contextStr}`
        : `SPECIALIST ANALYSIS:\n${contextStr}`,
    };
  }

  /**
   * Analyze task and determine delegation strategy.
   * Capped by WorkspacePolicy.maxSubagents when provided.
   */
  private analyzeAndDelegate(input: RunInput, maxSubagents: number | null = null): AgentDelegation {
    const task: AgentTask = {
      id: randomUUID(),
      role: "supervisor",
      description: input.goal,
      input: {
        goal: input.goal,
        constraints: input.constraints,
        projectId: input.projectId,
      },
      output: null,
      status: "pending",
      dependencies: [],
    };

    const decision = this.supervisor.makeDecision(task);

    const assignedAgents: AgentRole[] = [];
    const taskAssignments: Array<{
      agent: AgentRole;
      taskDescription: string;
      priority: number;
    }> = [];

    // Always include planner for complex tasks
    if (input.goal.length > 50 || input.constraints) {
      assignedAgents.push("planner");
      taskAssignments.push({
        agent: "planner",
        taskDescription: `Plan implementation for: ${input.goal}`,
        priority: 1,
      });
    }

    // Always include coder
    assignedAgents.push("coder");
    taskAssignments.push({
      agent: "coder",
      taskDescription: `Implement: ${input.goal}`,
      priority: 2,
    });

    // Include reviewer for code changes
    if (input.goal.toLowerCase().includes("code") || input.goal.toLowerCase().includes("implement")) {
      assignedAgents.push("reviewer");
      taskAssignments.push({
        agent: "reviewer",
        taskDescription: `Review implementation for: ${input.goal}`,
        priority: 3,
      });
    }

    // Include tester for testing tasks
    if (input.goal.toLowerCase().includes("test") || input.goal.toLowerCase().includes("verify")) {
      assignedAgents.push("tester");
      taskAssignments.push({
        agent: "tester",
        taskDescription: `Test implementation for: ${input.goal}`,
        priority: 4,
      });
    }

    // Include devops for deployment tasks
    if (input.goal.toLowerCase().includes("deploy") || input.goal.toLowerCase().includes("build")) {
      assignedAgents.push("devops");
      taskAssignments.push({
        agent: "devops",
        taskDescription: `Deploy: ${input.goal}`,
        priority: 5,
      });
    }

    // Enforce maxSubagents as a hard cap on the number of delegated specialists
    if (maxSubagents !== null && maxSubagents > 0 && taskAssignments.length > maxSubagents) {
      const capped = taskAssignments.slice(0, maxSubagents);
      const cappedAgents = assignedAgents.slice(0, maxSubagents);
      return {
        supervisorDecision: decision,
        assignedAgents: cappedAgents,
        taskAssignments: capped,
      };
    }

    return {
      supervisorDecision: decision,
      assignedAgents,
      taskAssignments,
    };
  }

  /**
   * Record agent execution results.
   */
  private async recordAgentResults(
    input: RunInput,
    delegation: AgentDelegation,
    outcome: RunOutcome,
    contexts: SpecialistContext[],
  ): Promise<void> {
    try {
      await this.events.publishAndEmit({
        taskId: input.taskId,
        runId: input.runId || null,
        eventType: "AGENT_DELEGATION_COMPLETED",
        actorType: "SYSTEM",
        payload: {
          outcome,
          assignedAgents: delegation.assignedAgents,
          decision: delegation.supervisorDecision,
          specialistOutputs: contexts.map((c) => ({ agent: c.agent, confidence: c.confidence })),
        },
      });

      // Record delegation decisions via the communication channel
      if (this.communication) {
        try {
          await this.communication.recordDecision(
            "supervisor",
            `Delegated to: ${delegation.assignedAgents.join(", ")}`,
            `Outcome: ${outcome}`,
            input.taskId,
          );
        } catch (err) {
          this.logger.warn({ err, taskId: input.taskId }, "Failed to record delegation decision");
        }
      }
    } catch (error) {
      this.logger.warn({ err: error, taskId: input.taskId }, "Failed to record agent results");
    }
  }

  /**
   * Get supervisor status.
   */
  getSupervisorStatus() {
    return this.supervisor.getAllAgentStatuses();
  }
}
