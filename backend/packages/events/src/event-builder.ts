import type { PlatformEvent, EventType } from "./types.js";

let eventCounter = 0;

export function createEvent(
  type: EventType,
  taskId: string,
  data: Record<string, unknown>,
  metadata?: PlatformEvent["metadata"],
): PlatformEvent {
  return {
    id: `evt_${Date.now()}_${++eventCounter}`,
    type,
    taskId,
    timestamp: new Date(),
    actor: metadata?.agentRole ? "agent" : "system",
    data,
    metadata,
  };
}

export function createRunEvent(type: EventType, taskId: string, runId: string, data: Record<string, unknown>, metadata?: PlatformEvent["metadata"]): PlatformEvent {
  return { ...createEvent(type, taskId, data, metadata), runId };
}
