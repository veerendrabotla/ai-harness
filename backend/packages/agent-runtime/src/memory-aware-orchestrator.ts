/**
 * Memory-Aware Orchestrator Wrapper.
 * Wraps the core TaskOrchestrator to inject project memory context
 * and extract learnings after execution.
 */
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@ai-harness/shared";
import { InMemoryProjectMemoryEngine } from "@ai-harness/project-memory";
import type { ProjectMemoryEngine, MemoryInsight } from "@ai-harness/project-memory";
import type { TaskOrchestrator, RunOutcome } from "./orchestrator.js";
import { EventPublisher } from "./event-publisher.js";
import type { RunInput } from "./run-input.js";

interface MemoryContext {
  insights: MemoryInsight[];
  architectureDecisions: string[];
  codingConventions: string[];
  previousBugs: string[];
  lessonsLearned: string[];
  userPreferences: string[];
}

/**
 * Memory-aware orchestrator that retrieves project context before execution
 * and extracts learnings after completion.
 */
export class MemoryAwareOrchestrator {
  private memoryEngine: ProjectMemoryEngine;

  constructor(
    private readonly orchestrator: TaskOrchestrator,
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly events: EventPublisher,
    memoryEngine?: ProjectMemoryEngine,
  ) {
    this.memoryEngine = memoryEngine ?? new InMemoryProjectMemoryEngine();
  }

  /**
   * Start a run with memory context injection.
   * Respects per-workspace toggle via FeatureFlag `memory_enabled` (defaults to enabled).
   * WorkspacePolicy currently has no memory toggle field; FeatureFlag is the pragmatic toggle layer.
   */
  async startRun(input: RunInput): Promise<RunOutcome> {
    // 0. Check per-workspace toggle -- FeatureFlag `memory_enabled` disables memory when explicitly false
    const memoryEnabled = await this.isMemoryEnabled(input.workspaceId);
    if (!memoryEnabled) {
      this.logger.info({ taskId: input.taskId, workspaceId: input.workspaceId }, "memory disabled for workspace, bypassing memory context");
      return this.orchestrator.startRun(input);
    }

    // 1. Retrieve relevant memories before execution
    const memoryContext = await this.retrieveMemoryContext(input.projectId, input.goal);

    // 2. Log memory retrieval
    await this.events.publishAndEmit({
      taskId: input.taskId,
      runId: input.runId || null,
      eventType: "MEMORY_CONTEXT_LOADED",
      actorType: "SYSTEM",
      payload: {
        insightCount: memoryContext.insights.length,
        architectureDecisions: memoryContext.architectureDecisions.length,
        codingConventions: memoryContext.codingConventions.length,
        previousBugs: memoryContext.previousBugs.length,
        lessonsLearned: memoryContext.lessonsLearned.length,
      },
    });

    // 3. Execute with memory context (inject into constraints if available)
    const enhancedInput = this.enhanceInputWithMemory(input, memoryContext);

    try {
      const outcome = await this.orchestrator.startRun(enhancedInput);

      // 4. Extract learnings on successful completion
      if (outcome === "COMPLETED") {
        await this.extractLearnings(input, memoryContext);
      }

      return outcome;
    } catch (error) {
      // 5. Record error patterns for future reference
      await this.recordErrorPattern(input, error);
      throw error;
    }
  }

  /**
   * Retrieve relevant memories for a project and context.
   */
  private async retrieveMemoryContext(projectId: string, goal: string): Promise<MemoryContext> {
    const insights = await this.memoryEngine.getRelevant(projectId, goal, 20);

    const architectureDecisions: string[] = [];
    const codingConventions: string[] = [];
    const previousBugs: string[] = [];
    const lessonsLearned: string[] = [];
    const userPreferences: string[] = [];

    for (const insight of insights) {
      switch (insight.memory.category) {
        case "architecture_decision":
          architectureDecisions.push(insight.memory.value);
          break;
        case "coding_convention":
          codingConventions.push(insight.memory.value);
          break;
        case "previous_bug":
          previousBugs.push(insight.memory.value);
          break;
        case "lesson_learned":
          lessonsLearned.push(insight.memory.value);
          break;
        case "user_preference":
          userPreferences.push(insight.memory.value);
          break;
      }
    }

    return {
      insights,
      architectureDecisions,
      codingConventions,
      previousBugs,
      lessonsLearned,
      userPreferences,
    };
  }

  /**
   * Enhance input with memory context.
   */
  private enhanceInputWithMemory(input: RunInput, memoryContext: MemoryContext): RunInput {
    const memoryHints: string[] = [];

    if (memoryContext.architectureDecisions.length > 0) {
      memoryHints.push(`Architecture decisions:\n${memoryContext.architectureDecisions.join("\n")}`);
    }
    if (memoryContext.codingConventions.length > 0) {
      memoryHints.push(`Coding conventions:\n${memoryContext.codingConventions.join("\n")}`);
    }
    if (memoryContext.previousBugs.length > 0) {
      memoryHints.push(`Previous bugs to avoid:\n${memoryContext.previousBugs.join("\n")}`);
    }
    if (memoryContext.lessonsLearned.length > 0) {
      memoryHints.push(`Lessons learned:\n${memoryContext.lessonsLearned.join("\n")}`);
    }
    if (memoryContext.userPreferences.length > 0) {
      memoryHints.push(`User preferences:\n${memoryContext.userPreferences.join("\n")}`);
    }

    if (memoryHints.length === 0) return input;

    const memoryContextStr = `\n\nPROJECT MEMORY (from previous runs):\n${memoryHints.join("\n\n")}`;

    return {
      ...input,
      constraints: input.constraints
        ? `${input.constraints}${memoryContextStr}`
        : memoryContextStr,
    };
  }

  /**
   * Extract learnings after successful completion.
   */
  private async extractLearnings(input: RunInput, _memoryContext: MemoryContext): Promise<void> {
    try {
      // Store the goal as a lesson learned if it was complex
      if (input.goal.length > 100) {
        await this.memoryEngine.remember(input.projectId, {
          projectId: input.projectId,
          category: "lesson_learned",
          key: `complex-task-${Date.now()}`,
          value: `Successfully completed: ${input.goal.slice(0, 200)}`,
          context: input.goal,
          confidence: 0.7,
          source: "agent_observation",
          references: [input.taskId],
        });
      }
    } catch (error) {
      this.logger.warn({ err: error, taskId: input.taskId }, "Failed to extract learnings");
    }
  }

  /**
   * Record error patterns for future reference.
   */
  private async recordErrorPattern(input: RunInput, error: unknown): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = error instanceof Error ? error.name : "UNKNOWN_ERROR";

      await this.memoryEngine.remember(input.projectId, {
        projectId: input.projectId,
        category: "recurring_failure",
        key: `error-${errorType}-${Date.now()}`,
        value: `Error during task: ${errorMessage.slice(0, 500)}`,
        context: `Task goal: ${input.goal}`,
        confidence: 0.8,
        source: "error_pattern",
        references: [input.taskId],
      });
    } catch (memError) {
      this.logger.warn({ err: memError, taskId: input.taskId }, "Failed to record error pattern");
    }
  }

  /**
   * Check per-workspace memory toggle. Uses FeatureFlag `memory_enabled`; missing flag defaults to true.
   * WorkspacePolicy has no dedicated memory field, so FeatureFlag is the toggle layer.
   */
  private async isMemoryEnabled(workspaceId: string): Promise<boolean> {
    try {
      const flag = await (this.prisma as unknown as { featureFlag: { findUnique: (args: unknown) => Promise<{ enabled: boolean } | null> } }).featureFlag.findUnique({
        where: { workspaceId_key: { workspaceId, key: "memory_enabled" } },
        select: { enabled: true },
      });
      if (!flag) return true;
      return flag.enabled;
    } catch (err) {
      this.logger.warn({ err, workspaceId }, "Failed to check memory feature flag, defaulting to enabled");
      return true;
    }
  }

  /**
   * Store a memory observation.
   */
  async observe(
    projectId: string,
    category: "architecture_decision" | "coding_convention" | "previous_bug" | "user_preference" | "deployment_config" | "recurring_failure" | "lesson_learned" | "file_pattern" | "dependency_note" | "performance_note",
    key: string,
    value: string,
    context: string,
  ): Promise<void> {
    await this.memoryEngine.remember(projectId, {
      projectId,
      category,
      key,
      value,
      context,
      confidence: 0.7,
      source: "agent_observation",
      references: [],
    });
  }

  /**
   * Get memory stats for a project.
   */
  async getMemoryStats(projectId: string) {
    return this.memoryEngine.stats(projectId);
  }
}
