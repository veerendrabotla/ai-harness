import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import type { EventActorType } from "@ai-harness/contracts";
import { redactValue } from "@ai-harness/shared";

/** Stable int hash of a taskId for pg_advisory_xact_lock (fits in signed int32 range). */
function hashTaskId(taskId: string): number {
  const hex = createHash("md5").update(taskId).digest("hex").slice(0, 8);
  const n = parseInt(hex, 16);
  // pg_advisory_xact_lock takes signed int; keep within int32
  return n > 0x7fffffff ? n - 0x100000000 : n;
}

export interface PersistedEvent {
  id: string;
  taskId: string;
  runId: string | null;
  sequenceNumber: number;
  eventType: string;
  actorType: EventActorType;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Event Publisher (AGENT_RUNTIME.md §17).
 * Persists an ordered event BEFORE publication; clients recover through replay.
 * Sequence numbers are allocated inside a transaction and protected by a
 * unique constraint on (task_id, sequence_number).
 */
export class EventPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly emit?: ((taskId: string, event: unknown) => void) | undefined,
  ) {}

  async publish(input: {
    taskId: string;
    runId?: string | null;
    eventType: string;
    actorType: EventActorType;
    payload?: Record<string, unknown>;
  }): Promise<{ id: string; sequenceNumber: bigint }> {
    const payload = input.payload ? (redactValue(input.payload) as Prisma.InputJsonValue) : Prisma.JsonNull;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Advisory lock on taskId hash — serializes concurrent publishers for the same task
          // without blocking publishers for different tasks. Gracefully skip if tx is a mock
          // (e.g. in unit tests where $executeRaw is not implemented).
          const maybeRaw = (tx as unknown as { $executeRaw?: unknown }).$executeRaw;
          if (typeof maybeRaw === "function") {
            const lockKey = hashTaskId(input.taskId);
            await (tx as unknown as { $executeRaw: (t: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
          }
          const last = await tx.taskEvent.aggregate({
            where: { taskId: input.taskId },
            _max: { sequenceNumber: true },
          });
          const next = (last._max.sequenceNumber ?? -1n) + 1n;
          const created = await tx.taskEvent.create({
            data: {
              id: randomUUID(),
              taskId: input.taskId,
              // run_id is a nullable uuid — never coerce to "" (invalid uuid)
              runId: input.runId || null,
              sequenceNumber: next,
              eventType: input.eventType,
              actorType: input.actorType,
              payload,
            },
          });
          return { id: created.id, sequenceNumber: created.sequenceNumber };
        }, { isolationLevel: "Serializable" });
      } catch (err) {
        const code = (err as { code?: string }).code;
        const isRetryable = code === "P2002" || code === "P2034"; // unique violation or serialization failure
        if (!isRetryable || attempt === 4) throw err;
        // Brief jitter before retry to reduce contention
        await new Promise((r) => setTimeout(r, 10 * (attempt + 1) + Math.random() * 20));
      }
    }
    throw new Error("unreachable");
  }

  /** Persist first, then fan out to realtime subscribers. */
  async publishAndEmit(input: {
    taskId: string;
    runId?: string | null;
    eventType: string;
    actorType: EventActorType;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const saved = await this.publish(input);
    this.emit?.(input.taskId, {
      id: saved.id,
      taskId: input.taskId,
      runId: input.runId || null,
      sequenceNumber: Number(saved.sequenceNumber),
      eventType: input.eventType,
      actorType: input.actorType,
      payload: input.payload ?? null,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Replay all events for a task, ordered by sequence number.
   * Used for recovery, debugging, and session restoration.
   */
  async replay(taskId: string, options?: {
    fromSequence?: number;
    toSequence?: number;
    eventTypes?: string[];
    limit?: number;
  }): Promise<PersistedEvent[]> {
    const where: Record<string, unknown> = { taskId };
    if (options?.fromSequence !== undefined || options?.toSequence !== undefined) {
      where.sequenceNumber = {};
      if (options.fromSequence !== undefined) {
        (where.sequenceNumber as Record<string, number>).gte = options.fromSequence;
      }
      if (options.toSequence !== undefined) {
        (where.sequenceNumber as Record<string, number>).lte = options.toSequence;
      }
    }
    if (options?.eventTypes && options.eventTypes.length > 0) {
      where.eventType = { in: options.eventTypes };
    }

    const events = await this.prisma.taskEvent.findMany({
      where,
      orderBy: { sequenceNumber: "asc" },
      take: options?.limit,
    });

    return events.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      runId: e.runId,
      sequenceNumber: Number(e.sequenceNumber),
      eventType: e.eventType,
      actorType: e.actorType as EventActorType,
      payload: e.payload as Record<string, unknown> | null,
      createdAt: e.createdAt,
    }));
  }

  /**
   * Replay events for a specific run.
   */
  async replayRun(taskId: string, runId: string): Promise<PersistedEvent[]> {
    const events = await this.prisma.taskEvent.findMany({
      where: { taskId, runId },
      orderBy: { sequenceNumber: "asc" },
    });

    return events.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      runId: e.runId,
      sequenceNumber: Number(e.sequenceNumber),
      eventType: e.eventType,
      actorType: e.actorType as EventActorType,
      payload: e.payload as Record<string, unknown> | null,
      createdAt: e.createdAt,
    }));
  }

  /**
   * Get the latest sequence number for a task.
   */
  async getLatestSequence(taskId: string): Promise<number> {
    const last = await this.prisma.taskEvent.aggregate({
      where: { taskId },
      _max: { sequenceNumber: true },
    });
    return Number(last._max.sequenceNumber ?? -1);
  }

  /**
   * Get event counts by type for a task.
   */
  async getEventStats(taskId: string): Promise<Record<string, number>> {
    const events = await this.prisma.taskEvent.findMany({
      where: { taskId },
      select: { eventType: true },
    });

    const stats: Record<string, number> = {};
    for (const event of events) {
      stats[event.eventType] = (stats[event.eventType] ?? 0) + 1;
    }
    return stats;
  }
}
