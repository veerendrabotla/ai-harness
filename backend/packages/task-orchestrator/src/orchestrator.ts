import { randomUUID } from "node:crypto";
import type {
  OrchestratorTask,
  ExecutionPlan,
  OrchestrationResult,
  TaskStatus,
  ExecutionMode,
} from "./types.js";

export class TaskOrchestrator {
  private plans = new Map<string, ExecutionPlan>();
  private taskHandlers = new Map<string, (task: OrchestratorTask) => Promise<unknown>>();

  registerHandler(name: string, handler: (task: OrchestratorTask) => Promise<unknown>): void {
    this.taskHandlers.set(name, handler);
  }

  createPlan(config: {
    name: string;
    mode: ExecutionMode;
    tasks: { name: string; dependencies?: string[]; priority?: OrchestratorTask["priority"] }[];
  }): ExecutionPlan {
    const tasks: OrchestratorTask[] = config.tasks.map((t) => ({
      id: randomUUID(),
      name: t.name,
      status: "pending" as TaskStatus,
      priority: t.priority || "medium",
      dependencies: t.dependencies || [],
    }));

    const plan: ExecutionPlan = {
      id: randomUUID(),
      name: config.name,
      mode: config.mode,
      tasks,
      createdAt: new Date(),
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  async executePlan(planId: string): Promise<OrchestrationResult> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const startTime = Date.now();
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];

    if (plan.mode === "sequential") {
      for (const task of plan.tasks) {
        if (!this.dependenciesMet(task, completedTasks, plan)) {
          task.status = "waiting";
          continue;
        }

        try {
          task.status = "running";
          task.startedAt = new Date();
          const handler = this.taskHandlers.get(task.name);
          if (handler) {
            task.result = await handler(task);
          }
          task.status = "completed";
          task.completedAt = new Date();
          completedTasks.push(task.id);
        } catch (error) {
          task.status = "failed";
          task.error = error instanceof Error ? error.message : String(error);
          failedTasks.push(task.id);
        }
      }
    } else if (plan.mode === "parallel") {
      const pending = [...plan.tasks];
      const running: Promise<void>[] = [];

      while (pending.length > 0 || running.length > 0) {
        const ready = pending.filter(
          (t) => this.dependenciesMet(t, completedTasks, plan) && t.status === "pending"
        );

        for (const task of ready) {
          pending.splice(pending.indexOf(task), 1);
          task.status = "running";
          task.startedAt = new Date();

          const p = (async () => {
            try {
              const handler = this.taskHandlers.get(task.name);
              if (handler) {
                task.result = await handler(task);
              }
              task.status = "completed";
              task.completedAt = new Date();
              completedTasks.push(task.id);
            } catch (error) {
              task.status = "failed";
              task.error = error instanceof Error ? error.message : String(error);
              failedTasks.push(task.id);
            }
          })();

          running.push(p);
        }

        if (running.length > 0) {
          await Promise.race(running);
          for (let i = running.length - 1; i >= 0; i--) {
            const p = running[i]!;
            const resolved = await Promise.race([p.then(() => true), Promise.resolve(false)]);
            if (resolved) running.splice(i, 1);
          }
        }
      }

      await Promise.all(running);
    }

    return {
      planId,
      completedTasks,
      failedTasks,
      duration: Date.now() - startTime,
      success: failedTasks.length === 0,
    };
  }

  private dependenciesMet(task: OrchestratorTask, completedTasks: string[], plan: ExecutionPlan): boolean {
    return task.dependencies.every((depId) => {
      const dep = plan.tasks.find((t) => t.id === depId);
      return dep?.status === "completed" || completedTasks.includes(depId);
    });
  }

  getPlan(planId: string): ExecutionPlan | undefined {
    return this.plans.get(planId);
  }

  cancelPlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    for (const task of plan.tasks) {
      if (task.status === "running" || task.status === "pending") {
        task.status = "cancelled";
      }
    }

    return true;
  }
}
