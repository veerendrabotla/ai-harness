import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { TASK_EVENT_TYPES } from "@ai-harness/domain";
import type { CheckpointStateReference } from "@ai-harness/shared";
import type { EventPublisher } from "./event-publisher.js";

export interface CheckpointInfo {
  id: string;
  taskId: string;
  projectId: string;
  type: string;
  label?: string;
  stateReference: unknown;
  createdAt: Date;
}

/**
 * Checkpoint Manager.
 *
 * Checkpoints are state REFERENCES, not database copies (AGENT_RUNTIME.md §13).
 * When a connected Local Bridge owns the project root, `execBridge` creates a
 * git-backed checkpoint reference on the user's machine; otherwise the attempt
 * is recorded as CHECKPOINT_SKIPPED with the exact reason — never faked.
 */
export class CheckpointManager {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventPublisher,
    private readonly execBridge?: ((toolName: string, input: Record<string, unknown>, timeoutMs: number) => Promise<Record<string, unknown>>) | undefined,
  ) {}

  async tryCreatePreExecution(input: {
    taskId: string;
    runId: string;
    projectId: string;
    label?: string;
  }): Promise<{ created: boolean; reason: string; checkpointId?: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      include: { bridge: true },
    });
    if (!project) return { created: false, reason: "PROJECT_NOT_FOUND" };

    const skip = async (reason: string) => {
      await this.events.publishAndEmit({
        taskId: input.taskId,
        runId: input.runId,
        eventType: TASK_EVENT_TYPES.CHECKPOINT_SKIPPED,
        actorType: "SYSTEM",
        payload: { reason },
      });
      return { created: false, reason };
    };

    if (!this.execBridge) {
      return skip(
        project.connectionType === "LOCAL_BRIDGE" ? "BRIDGE_GATEWAY_UNAVAILABLE" : "CLOUD_SANDBOX_NOT_PROVISIONED",
      );
    }
    if (project.connectionType === "LOCAL_BRIDGE") {
      if (!project.bridge || project.bridge.status !== "CONNECTED") {
        return skip("BRIDGE_DISCONNECTED");
      }
      try {
        const ref = (await this.execBridge("checkpoint.create", { root: project.rootReference }, 60_000)) as unknown as CheckpointStateReference;
        const checkpoint = await this.prisma.checkpoint.create({
          data: {
            id: randomUUID(),
            taskId: input.taskId,
            projectId: input.projectId,
            checkpointType: "PRE_EXECUTION",
            stateReference: ref as unknown as import("@prisma/client").Prisma.InputJsonValue,
          },
        });
        await this.events.publishAndEmit({
          taskId: input.taskId,
          runId: input.runId,
          eventType: TASK_EVENT_TYPES.CHECKPOINT_CREATED,
          actorType: "SYSTEM",
          payload: {
            checkpointId: checkpoint.id,
            kind: ref.kind,
            headBefore: ref.headBefore,
            createdStash: ref.createdStash,
            label: input.label,
          },
        });
        // Best-effort cleanup of old checkpoints per project (keep last 10)
        void this.cleanupOldCheckpoints(input.projectId, 10).catch(() => undefined);
        return { created: true, reason: "OK", checkpointId: checkpoint.id };
      } catch (err) {
        return skip(`BRIDGE_CHECKPOINT_FAILED: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
      }
    }
    return skip("CLOUD_SANDBOX_NOT_PROVISIONED");
  }

  async tryCreatePreStep(input: {
    taskId: string;
    runId: string;
    projectId: string;
    toolName: string;
    stepId: string;
    label?: string;
  }): Promise<{ created: boolean; reason: string; checkpointId?: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      include: { bridge: true },
    });
    if (!project) return { created: false, reason: "PROJECT_NOT_FOUND" };

    const skip = async (reason: string) => {
      await this.events.publishAndEmit({
        taskId: input.taskId,
        runId: input.runId,
        eventType: TASK_EVENT_TYPES.CHECKPOINT_SKIPPED,
        actorType: "SYSTEM",
        payload: { reason, toolName: input.toolName, stepId: input.stepId },
      });
      return { created: false, reason };
    };

    if (!this.execBridge) {
      return skip(
        project.connectionType === "LOCAL_BRIDGE" ? "BRIDGE_GATEWAY_UNAVAILABLE" : "CLOUD_SANDBOX_NOT_PROVISIONED",
      );
    }
    if (project.connectionType === "LOCAL_BRIDGE") {
      if (!project.bridge || project.bridge.status !== "CONNECTED") {
        return skip("BRIDGE_DISCONNECTED");
      }
      try {
        const ref = (await this.execBridge("checkpoint.create", { root: project.rootReference }, 60_000)) as unknown as CheckpointStateReference;
        const checkpoint = await this.prisma.checkpoint.create({
          data: {
            id: randomUUID(),
            taskId: input.taskId,
            projectId: input.projectId,
            checkpointType: "PRE_EXECUTION",
            stateReference: ref as unknown as import("@prisma/client").Prisma.InputJsonValue,
          },
        });
        await this.events.publishAndEmit({
          taskId: input.taskId,
          runId: input.runId,
          eventType: TASK_EVENT_TYPES.CHECKPOINT_CREATED,
          actorType: "SYSTEM",
          payload: {
            checkpointId: checkpoint.id,
            kind: ref.kind,
            headBefore: ref.headBefore,
            createdStash: ref.createdStash,
            label: input.label ?? `pre-step:${input.toolName}:${input.stepId}`,
            toolName: input.toolName,
            stepId: input.stepId,
          },
        });
        void this.cleanupOldCheckpoints(input.projectId, 10).catch(() => undefined);
        return { created: true, reason: "OK", checkpointId: checkpoint.id };
      } catch (err) {
        return skip(`BRIDGE_CHECKPOINT_FAILED: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
      }
    }
    return skip("CLOUD_SANDBOX_NOT_PROVISIONED");
  }

  /** Executes a confirmed rollback through the bridge and records it. */
  async rollback(input: {
    checkpointId: string;
    userId: string;
  }): Promise<Record<string, unknown>> {
    const checkpoint = await this.prisma.checkpoint.findUnique({
      where: { id: input.checkpointId },
      include: { project: true },
    });
    if (!checkpoint) {
      throw Object.assign(new Error("Checkpoint not found"), { code: "NOT_FOUND" });
    }
    if (!this.execBridge) {
      throw Object.assign(new Error("No execution environment available"), { code: "BRIDGE_DISCONNECTED" });
    }
    const ref = checkpoint.stateReference as unknown as CheckpointStateReference;
    const result = await this.execBridge(
      "checkpoint.rollback",
      { root: checkpoint.project.rootReference, ref: ref.ref },
      120_000,
    );
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.userId,
        workspaceId: checkpoint.project.workspaceId,
        action: "CHECKPOINT_ROLLED_BACK",
        entityType: "CHECKPOINT",
        entityId: checkpoint.id,
        metadata: { taskId: checkpoint.taskId, resetTo: ref.ref },
      },
    });
    await this.events.publishAndEmit({
      taskId: checkpoint.taskId,
      runId: null,
      eventType: "CHECKPOINT_ROLLED_BACK",
      actorType: "USER",
      payload: { checkpointId: checkpoint.id, resetTo: ref.ref },
    });
    return result;
  }

  /** List all checkpoints for a task. */
  async listCheckpoints(taskId: string): Promise<CheckpointInfo[]> {
    const checkpoints = await this.prisma.checkpoint.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });

    return checkpoints.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      projectId: c.projectId,
      type: c.checkpointType,
      stateReference: c.stateReference,
      createdAt: c.createdAt,
    }));
  }

  /** Get a specific checkpoint. */
  async getCheckpoint(checkpointId: string): Promise<CheckpointInfo | null> {
    const checkpoint = await this.prisma.checkpoint.findUnique({
      where: { id: checkpointId },
    });
    if (!checkpoint) return null;

    return {
      id: checkpoint.id,
      taskId: checkpoint.taskId,
      projectId: checkpoint.projectId,
      type: checkpoint.checkpointType,
      stateReference: checkpoint.stateReference,
      createdAt: checkpoint.createdAt,
    };
  }

  /** Delete old checkpoints, keeping only the most recent N per task. */
  async cleanupCheckpoints(taskId: string, keepCount: number = 5): Promise<number> {
    const checkpoints = await this.prisma.checkpoint.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });

    if (checkpoints.length <= keepCount) return 0;

    const toDelete = checkpoints.slice(keepCount);
    await this.prisma.checkpoint.deleteMany({
      where: { id: { in: toDelete.map((c) => c.id) } },
    });

    return toDelete.length;
  }

  /** Delete old checkpoints, keeping only the most recent N per project. */
  async cleanupOldCheckpoints(projectId: string, keepCount: number = 10): Promise<number> {
    const checkpoints = await this.prisma.checkpoint.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (checkpoints.length <= keepCount) return 0;

    const toDelete = checkpoints.slice(keepCount);
    await this.prisma.checkpoint.deleteMany({
      where: { id: { in: toDelete.map((c) => c.id) } },
    });

    return toDelete.length;
  }
}

/** Interface preserved for future bridge/sandbox-backed implementations. */
export interface ICheckpointManager {
  tryCreatePreExecution(input: {
    taskId: string;
    runId: string;
    projectId: string;
  }): Promise<{ created: boolean; reason: string; checkpointId?: string }>;
  tryCreatePreStep(input: {
    taskId: string;
    runId: string;
    projectId: string;
    toolName: string;
    stepId: string;
  }): Promise<{ created: boolean; reason: string; checkpointId?: string }>;
  cleanupOldCheckpoints(projectId: string, keepCount?: number): Promise<number>;
}

// Explicit structural check that the class satisfies the interface.
type CheckpointManagerCheck = ICheckpointManager;
const _checkpointManagerCheck: CheckpointManagerCheck = null as unknown as CheckpointManager;
void _checkpointManagerCheck;
