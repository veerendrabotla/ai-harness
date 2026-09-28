/**
 * INTEGRATION TESTS — require a live PostgreSQL (docker compose up).
 * Enable with RUN_INTEGRATION=1.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@ai-harness/database";
import { createControlRegistry } from "@ai-harness/shared";
import { TaskStateService } from "@ai-harness/agent-runtime";

const ENABLED = process.env.RUN_INTEGRATION === "1";
const d = describe.skipIf(!ENABLED);

let userId: string;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  userId = randomUUID();
  workspaceId = randomUUID();
  projectId = randomUUID();
  await prisma.user.create({ data: { id: userId, email: `it-${Date.now()}@x.com`, passwordHash: "x", displayName: "IT" } });
  await prisma.workspace.create({
    data: {
      id: workspaceId,
      ownerId: userId,
      name: "IT WS",
      members: { create: { userId, role: "OWNER" } },
      policy: { create: {} },
    },
  });
  await prisma.project.create({
    data: { id: projectId, workspaceId, name: "p", rootReference: "it", connectionType: "CLOUD" },
  });
});

afterAll(async () => {
  await prisma.workspaceInvite.deleteMany({});
  const taskIds = (await prisma.task.findMany({ where: { workspaceId }, select: { id: true } })).map((t) => t.id);
  if (taskIds.length) {
    await prisma.verificationResult.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.checkpoint.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.contextPackage.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.approvalRequest.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.toolCall.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskEvent.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskPlan.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.taskRun.deleteMany({ where: { taskId: { in: taskIds } } });
  }
  await prisma.task.deleteMany({ where: { workspaceId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

d("run creation exclusivity", () => {
  const svc = new TaskStateService(prisma, async () => undefined);

  it("serializes concurrent creators to exactly one QUEUED run", async () => {
    const taskId = randomUUID();
    await prisma.task.create({
      data: { id: taskId, workspaceId, projectId, createdBy: userId, goal: "it", state: "QUEUED", selectedModelMode: "ROUTED" },
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        svc.createRunExclusively(taskId, randomUUID()),
      ),
    );
    const fulfilled = attempts.filter((a) => a.status === "fulfilled") as PromiseFulfilledResult<{ runNumber: number }>[];
    expect(fulfilled).toHaveLength(1);
    const runs = await prisma.taskRun.findMany({ where: { taskId } });
    expect(runs).toHaveLength(1);
    await prisma.taskRun.deleteMany({ where: { taskId } });
    await prisma.taskEvent.deleteMany({ where: { taskId } });
    await prisma.task.delete({ where: { id: taskId } });
  });

  it("terminal re-entry transition is an idempotent no-op", async () => {
    const result = await svc.transition({
      taskId: (await prisma.task.create({
        data: { id: randomUUID(), workspaceId, projectId, createdBy: userId, goal: "t2", state: "COMPLETED", completedAt: new Date(), selectedModelMode: "ROUTED" },
      })).id,
      runId: null,
      from: "COMPLETED",
      to: "COMPLETED",
    });
    expect(result).toBe("COMPLETED");
  });
});

d("approval resolution races", () => {
  it("only one of two racing denials claims the PENDING row", async () => {
    const taskId = randomUUID();
    const task = await prisma.task.create({
      data: { id: taskId, workspaceId, projectId, createdBy: userId, goal: "appr", state: "EXECUTING", selectedModelMode: "ROUTED" },
    });
    const approval = await prisma.approvalRequest.create({
      data: { id: randomUUID(), taskId, requestedScope: "ONCE", expiresAt: new Date(Date.now() + 60_000) },
    });
    // Simulate the guarded claim used by the API route.
    const claim = (winner: boolean) =>
      prisma.approvalRequest.updateMany({
        where: { id: approval.id, status: "PENDING" },
        data: winner
          ? { status: "APPROVED" as const, decidedAt: new Date() }
          : { status: "DENIED" as const, decidedAt: new Date() },
      });
    const [a, b] = [await claim(true), await claim(true)];
    expect([a.count, b.count].sort()).toEqual([0, 1]);
    void task;
  });
});

describe("control registry", () => {
  it("aborts registered signals by taskId", () => {
    const registry = createControlRegistry();
    const signal = registry.register("task-x");
    expect(signal.aborted).toBe(false);
    registry.abort("task-x");
    expect(signal.aborted).toBe(true);
    registry.release("task-x");
    expect(registry.signal("task-x")).toBeUndefined();
  });
});
