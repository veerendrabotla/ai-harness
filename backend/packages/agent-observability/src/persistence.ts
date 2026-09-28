/**
 * Trace Persistence Service.
 * Saves execution traces to PostgreSQL for long-term storage and querying.
 */
import type { PrismaClient } from "@prisma/client";
import type { ExecutionTrace, TraceOutcome, TokenUsage } from "./types.js";

export class TracePersistence {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Save a trace to the database.
   */
  async saveTrace(trace: ExecutionTrace): Promise<void> {
    await this.prisma.executionTrace.upsert({
      where: { id: trace.id },
      create: {
        id: trace.id,
        taskId: trace.taskId,
        runId: trace.runId,
        goal: trace.goal,
        reasoning: trace.reasoning as never,
        plan: trace.plan as never,
        executions: trace.executions as never,
        observations: trace.observations as never,
        decisions: trace.decisions as never,
        evidence: trace.evidence as never,
        verification: trace.verification as never,
        outcome: trace.outcome as never,
        tokenUsage: trace.tokenUsage as never,
        duration: trace.duration,
        completedAt: trace.completedAt,
      },
      update: {
        reasoning: trace.reasoning as never,
        plan: trace.plan as never,
        executions: trace.executions as never,
        observations: trace.observations as never,
        decisions: trace.decisions as never,
        evidence: trace.evidence as never,
        verification: trace.verification as never,
        outcome: trace.outcome as never,
        tokenUsage: trace.tokenUsage as never,
        duration: trace.duration,
        completedAt: trace.completedAt,
      },
    });
  }

  /**
   * Get a trace by ID.
   */
  async getTrace(id: string): Promise<ExecutionTrace | null> {
    const record = await this.prisma.executionTrace.findUnique({ where: { id } });
    if (!record) return null;
    return this.toTrace(record);
  }

  /**
   * Get traces for a task.
   */
  async getTracesByTask(taskId: string): Promise<ExecutionTrace[]> {
    const records = await this.prisma.executionTrace.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });
    return records.map((r) => this.toTrace(r));
  }

  /**
   * Get trace summaries for a task (lightweight).
   */
  async getTraceSummaries(taskId: string): Promise<Array<{
    id: string;
    goal: string;
    status: string;
    duration: number;
    createdAt: Date;
  }>> {
    const records = await this.prisma.executionTrace.findMany({
      where: { taskId },
      select: {
        id: true,
        goal: true,
        outcome: true,
        duration: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return records.map((r) => ({
      id: r.id,
      goal: r.goal,
      status: (r.outcome as unknown as TraceOutcome).status ?? "unknown",
      duration: r.duration,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Convert a DB record to a trace.
   */
  private toTrace(record: {
    id: string;
    taskId: string;
    runId: string;
    goal: string;
    reasoning: unknown;
    plan: unknown;
    executions: unknown;
    observations: unknown;
    decisions: unknown;
    evidence: unknown;
    verification: unknown;
    outcome: unknown;
    tokenUsage: unknown;
    duration: number;
    createdAt: Date;
    completedAt: Date | null;
  }): ExecutionTrace {
    return {
      id: record.id,
      taskId: record.taskId,
      runId: record.runId,
      goal: record.goal,
      reasoning: record.reasoning as ExecutionTrace["reasoning"],
      plan: record.plan as ExecutionTrace["plan"],
      executions: record.executions as ExecutionTrace["executions"],
      observations: record.observations as ExecutionTrace["observations"],
      decisions: record.decisions as ExecutionTrace["decisions"],
      evidence: record.evidence as ExecutionTrace["evidence"],
      verification: record.verification as ExecutionTrace["verification"],
      outcome: record.outcome as unknown as TraceOutcome,
      tokenUsage: record.tokenUsage as unknown as TokenUsage,
      duration: record.duration,
      createdAt: record.createdAt,
      completedAt: record.completedAt ?? new Date(),
    };
  }
}
