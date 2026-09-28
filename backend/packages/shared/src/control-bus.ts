import type { Redis } from "ioredis";

export const TASK_CONTROL_CHANNEL = "ai-harness:task-control";
export type TaskControlAction = "cancel" | "pause";

export async function publishTaskControl(
  publisher: Redis,
  taskId: string,
  action: TaskControlAction,
): Promise<void> {
  await publisher.publish(TASK_CONTROL_CHANNEL, JSON.stringify({ taskId, action }));
}

export interface ControlRegistry {
  register(taskId: string): AbortSignal;
  signal(taskId: string): AbortSignal | undefined;
  release(taskId: string): void;
  abort(taskId: string): void;
}

/** In-memory registry of per-run abort controllers (one process side). */
export function createControlRegistry(): ControlRegistry {
  const map = new Map<string, AbortController>();
  return {
    register(taskId) {
      const existing = map.get(taskId);
      if (existing) return existing.signal;
      const controller = new AbortController();
      map.set(taskId, controller);
      return controller.signal;
    },
    signal(taskId) {
      return map.get(taskId)?.signal;
    },
    release(taskId) {
      map.delete(taskId);
    },
    abort(taskId) {
      map.get(taskId)?.abort();
    },
  };
}

/** Subscribes a Redis duplicate and aborts matching controllers on cancel messages. */
export function subscribeTaskControl(
  subscriber: Redis,
  registry: ControlRegistry,
): void {
  void subscriber.subscribe(TASK_CONTROL_CHANNEL);
  subscriber.on("message", (_channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message) as { taskId?: string; action?: string };
      if (parsed.taskId && parsed.action === "cancel") registry.abort(parsed.taskId);
    } catch (err) {
      console.error("[ControlBus] malformed task control message:", err);
    }
  });
}
