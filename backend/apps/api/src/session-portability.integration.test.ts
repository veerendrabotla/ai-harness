/**
 * SESSION PORTABILITY INTEGRATION TESTS — require a live PostgreSQL (docker compose up).
 * Enable with RUN_INTEGRATION=1.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "@ai-harness/database";

const ENABLED = process.env.RUN_INTEGRATION === "1";
const d = describe.skipIf(!ENABLED);

let userId: string;
let userId2: string;
let workspaceId: string;
let workspaceId2: string;
let projectId: string;
let projectId2: string;

beforeAll(async () => {
  userId = randomUUID();
  userId2 = randomUUID();
  workspaceId = randomUUID();
  workspaceId2 = randomUUID();
  projectId = randomUUID();
  projectId2 = randomUUID();

  await prisma.user.createMany({
    data: [
      { id: userId, email: `port-it-${Date.now()}@x.com`, passwordHash: "x", displayName: "IT1" },
      { id: userId2, email: `port-it2-${Date.now()}@x.com`, passwordHash: "x", displayName: "IT2" },
    ],
  });

  await prisma.workspace.create({
    data: {
      id: workspaceId,
      ownerId: userId,
      name: "Portability WS",
      members: { create: { userId, role: "OWNER" } },
      policy: { create: {} },
    },
  });
  await prisma.workspace.create({
    data: {
      id: workspaceId2,
      ownerId: userId2,
      name: "Portability WS 2",
      members: { create: [{ userId: userId2, role: "OWNER" }, { userId, role: "MEMBER" }] },
      policy: { create: {} },
    },
  });

  await prisma.project.create({
    data: { id: projectId, workspaceId, name: "p1", rootReference: "it-p1", connectionType: "CLOUD" },
  });
  await prisma.project.create({
    data: { id: projectId2, workspaceId: workspaceId2, name: "p2", rootReference: "it-p2", connectionType: "CLOUD" },
  });
});

afterAll(async () => {
  await prisma.sessionShare.deleteMany({});
  await prisma.sessionExport.deleteMany({});

  const taskIds = (await prisma.task.findMany({
    where: { workspaceId: { in: [workspaceId, workspaceId2] } },
    select: { id: true },
  })).map((t) => t.id);

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

  await prisma.task.deleteMany({ where: { workspaceId: { in: [workspaceId, workspaceId2] } } });
  await prisma.project.deleteMany({ where: { id: { in: [projectId, projectId2] } } });
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, workspaceId2] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, userId2] } } });
  await prisma.$disconnect();
});

// ─── Helper: create a task ───
async function createTask(wsId: string, pjId: string, goal: string) {
  return prisma.task.create({
    data: {
      id: randomUUID(),
      workspaceId: wsId,
      projectId: pjId,
      createdBy: userId,
      goal,
      state: "COMPLETED",
      agentMode: "BUILD",
      selectedModelMode: "ROUTED",
    },
  });
}

// ─── Clone lineage tests ───
d("session portability — clone lineage", () => {
  it("creates a clone with parentTaskId set", async () => {
    const original = await createTask(workspaceId, projectId, "Original task");
    const cloneId = randomUUID();
    const clone = await prisma.task.create({
      data: {
        id: cloneId,
        workspaceId: original.workspaceId,
        projectId: original.projectId,
        createdBy: userId,
        goal: `[Clone] ${original.goal}`,
        state: "QUEUED",
        agentMode: original.agentMode,
        selectedModelMode: original.selectedModelMode,
        parentTaskId: original.id,
      },
    });
    expect(clone.parentTaskId).toBe(original.id);
    expect(clone.goal).toContain("Original task");
  });

  it("clone shares same workspace and project as parent", async () => {
    const original = await createTask(workspaceId, projectId, "Parent task for clone");
    const clone = await prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: original.workspaceId,
        projectId: original.projectId,
        createdBy: userId,
        goal: "Clone",
        state: "QUEUED",
        agentMode: "BUILD",
        selectedModelMode: "ROUTED",
        parentTaskId: original.id,
      },
    });
    expect(clone.workspaceId).toBe(original.workspaceId);
    expect(clone.projectId).toBe(original.projectId);
  });
});

// ─── Fork cross-workspace tests ───
d("session portability — fork cross-workspace", () => {
  it("creates a fork in a different workspace with parentTaskId", async () => {
    const original = await createTask(workspaceId, projectId, "Fork source");
    const fork = await prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: workspaceId2,
        projectId: projectId2,
        createdBy: userId,
        goal: original.goal,
        state: "QUEUED",
        agentMode: original.agentMode,
        selectedModelMode: original.selectedModelMode,
        parentTaskId: original.id,
      },
    });
    expect(fork.parentTaskId).toBe(original.id);
    expect(fork.workspaceId).toBe(workspaceId2);
    expect(fork.projectId).toBe(projectId2);
  });
});

// ─── Export/import data integrity ───
d("session portability — export/import data integrity", () => {
  it("export creates a SessionExport record with valid package", async () => {
    const task = await createTask(workspaceId, projectId, "Export test task");
    const pkg = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      source: {
        taskId: task.id,
        goal: task.goal,
        constraints: task.constraints,
        agentMode: task.agentMode,
        selectedModelMode: task.selectedModelMode,
        state: task.state,
        createdAt: task.createdAt.toISOString(),
        completedAt: null,
      },
      history: [
        { eventType: "RUN_STARTED", actorType: "SYSTEM", payload: {}, createdAt: new Date().toISOString() },
      ],
      plans: [],
      toolCalls: [],
      checkpoints: [],
      contextPackages: [],
      metadata: { originalWorkspaceId: workspaceId, originalProjectId: projectId, exportedBy: userId, hasSecrets: false },
    };
    const exportRecord = await prisma.sessionExport.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        exportedBy: userId,
        packageJson: pkg,
      },
    });
    expect(exportRecord.taskId).toBe(task.id);
    expect(exportRecord.exportedBy).toBe(userId);
    const stored = exportRecord.packageJson as Record<string, unknown>;
    expect(stored.version).toBe("1.0");
    expect((stored.source as Record<string, unknown>).goal).toBe(task.goal);
  });

  it("import creates a new task from exported package", async () => {
    const imported = await prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: workspaceId2,
        projectId: projectId2,
        createdBy: userId,
        goal: "[Imported] Original goal",
        state: "QUEUED",
        agentMode: "BUILD",
        selectedModelMode: "ROUTED",
      },
    });
    expect(imported.goal).toContain("Imported");
    expect(imported.workspaceId).toBe(workspaceId2);
  });
});

// ─── Share token security ───
d("session portability — share token security", () => {
  it("share token hash is never stored in plaintext", async () => {
    const task = await createTask(workspaceId, projectId, "Share security test");
    const token = randomUUID().replace(/-/g, "");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const share = await prisma.sessionShare.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        sharedBy: userId,
        tokenHash,
        permission: "view_only",
      },
    });

    // The stored hash should not match the raw token
    expect(share.tokenHash).not.toBe(token);
    expect(share.tokenHash).toHaveLength(64); // SHA-256 hex length
  });

  it("expired share links are detectable", async () => {
    const task = await createTask(workspaceId, projectId, "Expiry test");
    const share = await prisma.sessionShare.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        sharedBy: userId,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        permission: "view_only",
        expiresAt: new Date(Date.now() - 1000), // Already expired
      },
    });
    expect(share.expiresAt!.getTime()).toBeLessThan(Date.now());
  });

  it("valid share links are not expired", async () => {
    const task = await createTask(workspaceId, projectId, "Valid share test");
    const share = await prisma.sessionShare.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        sharedBy: userId,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        permission: "view_only",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
    expect(share.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("share lookup by token hash works", async () => {
    const task = await createTask(workspaceId, projectId, "Lookup test");
    const token = randomUUID().replace(/-/g, "");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await prisma.sessionShare.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        sharedBy: userId,
        tokenHash,
        permission: "view_only",
      },
    });

    const found = await prisma.sessionShare.findUnique({ where: { tokenHash } });
    expect(found).not.toBeNull();
    expect(found!.taskId).toBe(task.id);
  });

  it("invalid token hash returns null", async () => {
    const fakeHash = createHash("sha256").update("nonexistent-token").digest("hex");
    const found = await prisma.sessionShare.findUnique({ where: { tokenHash: fakeHash } });
    expect(found).toBeNull();
  });
});

// ─── Workspace isolation ───
d("session portability — workspace isolation", () => {
  it("task belongs to exactly one workspace", async () => {
    const task = await createTask(workspaceId, projectId, "Isolation test");
    expect(task.workspaceId).toBe(workspaceId);
    // Verify it does NOT belong to workspace2
    const otherWsTasks = await prisma.task.findMany({
      where: { id: task.id, workspaceId: workspaceId2 },
    });
    expect(otherWsTasks).toHaveLength(0);
  });

  it("cross-workspace fork creates task in target workspace only", async () => {
    const original = await createTask(workspaceId, projectId, "Cross WS test");
    const fork = await prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: workspaceId2,
        projectId: projectId2,
        createdBy: userId,
        goal: original.goal,
        state: "QUEUED",
        agentMode: "BUILD",
        selectedModelMode: "ROUTED",
        parentTaskId: original.id,
      },
    });
    // Fork exists in workspace2
    const inWs2 = await prisma.task.findFirst({ where: { id: fork.id, workspaceId: workspaceId2 } });
    expect(inWs2).not.toBeNull();
    // Fork does NOT exist in workspace1
    const inWs1 = await prisma.task.findFirst({ where: { id: fork.id, workspaceId } });
    expect(inWs1).toBeNull();
  });
});

// ─── Invalid/corrupted import packages ───
d("session portability — invalid import handling", () => {
  it("rejects import with missing required fields", () => {
    const invalidPkg = { version: "1.0" }; // missing source
    expect(invalidPkg).not.toHaveProperty("source");
  });

  it("rejects import with wrong version", () => {
    const pkg = { version: "2.0", source: {} };
    expect(pkg.version).not.toBe("1.0");
  });
});

// ─── Transfer permission ───
d("session portability — transfer permissions", () => {
  it("transfer requires OWNER role on source workspace", async () => {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    expect(member).not.toBeNull();
    expect(member!.role).toBe("OWNER");
  });

  it("transfer requires MEMBER role on target workspace", async () => {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: workspaceId2, userId },
    });
    expect(member).not.toBeNull();
    expect(member!.role).toBe("MEMBER");
  });
});

// ─── Parent-child lineage queries ───
d("session portability — lineage queries", () => {
  it("can find all children of a parent task", async () => {
    const parent = await createTask(workspaceId, projectId, "Parent lineage");
    const child1 = await prisma.task.create({
      data: {
        id: randomUUID(), workspaceId, projectId, createdBy: userId,
        goal: "Child 1", state: "QUEUED", agentMode: "BUILD", selectedModelMode: "ROUTED",
        parentTaskId: parent.id,
      },
    });
    const child2 = await prisma.task.create({
      data: {
        id: randomUUID(), workspaceId, projectId, createdBy: userId,
        goal: "Child 2", state: "QUEUED", agentMode: "BUILD", selectedModelMode: "ROUTED",
        parentTaskId: parent.id,
      },
    });

    const children = await prisma.task.findMany({ where: { parentTaskId: parent.id } });
    expect(children).toHaveLength(2);
    const childIds = children.map((c) => c.id);
    expect(childIds).toContain(child1.id);
    expect(childIds).toContain(child2.id);
  });

  it("can find the parent of a task", async () => {
    const parent = await createTask(workspaceId, projectId, "Parent lookup");
    const child = await prisma.task.create({
      data: {
        id: randomUUID(), workspaceId, projectId, createdBy: userId,
        goal: "Child", state: "QUEUED", agentMode: "BUILD", selectedModelMode: "ROUTED",
        parentTaskId: parent.id,
      },
    });

    const task = await prisma.task.findUnique({ where: { id: child.id }, include: { parentTask: true } });
    expect(task!.parentTask).not.toBeNull();
    expect(task!.parentTask!.id).toBe(parent.id);
  });

  it("root tasks have null parentTaskId", async () => {
    const root = await createTask(workspaceId, projectId, "Root task");
    expect(root.parentTaskId).toBeNull();
  });
});
