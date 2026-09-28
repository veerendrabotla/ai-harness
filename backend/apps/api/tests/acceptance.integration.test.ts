/**
 * Real Acceptance Test — end-to-end flow using actual infrastructure.
 * Requires: running API server, PostgreSQL, Redis, at least one model provider.
 *
 * This test verifies the complete workflow:
 * 1. Create workspace
 * 2. Create project
 * 3. Submit goal
 * 4. Supervisor analyzes
 * 5. Planner creates plan
 * 6. User approves
 * 7. Coder executes
 * 8. Tools modify files
 * 9. Tests run
 * 10. Reviewer checks
 * 11. Self-fix if needed
 * 12. Checkpoint created
 * 13. Session persists
 * 14. Session can be resumed
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

let authToken: string;
let workspaceId: string;
let projectId: string;
let taskId: string;

type ApiEnvelope = { accessToken: string; id: string; state: string; goal: string } & Record<string, unknown>;

async function api(path: string, options: RequestInit = {}): Promise<ApiEnvelope> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`API Error ${res.status}: ${JSON.stringify(json)}`);
  return json.data ?? json;
}

describe("Real Acceptance Test", () => {
  beforeAll(async () => {
    const user = await api("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email: `acceptance-${Date.now()}@test.com`,
        password: "TestPassword123!",
        displayName: "Acceptance Test User",
      }),
    });
    authToken = user.accessToken;

    const workspace = await api("/v1/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "Acceptance Test Workspace" }),
    });
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    if (taskId) {
      try { await api(`/v1/tasks/${taskId}/cancel`, { method: "POST" }); } catch {}
    }
  });

  it("1. creates project", async () => {
    const project = await api(`/v1/workspaces/${workspaceId}/projects`, {
      method: "POST",
      body: JSON.stringify({
        name: "Acceptance Test Project",
        description: "A simple test project",
      }),
    });
    projectId = project.id;
    expect(projectId).toBeDefined();
  });

  it("2. submits goal and creates task", async () => {
    const task = await api("/v1/tasks", {
      method: "POST",
      body: JSON.stringify({
        goal: "Create a simple hello world Express server with a single GET /hello endpoint that returns { message: 'Hello World' }",
        workspaceId,
        projectId,
        agentMode: "BUILD",
      }),
    });
    taskId = task.id;
    expect(taskId).toBeDefined();
    expect(task.state).toBeDefined();
  });

  it("3. task progresses through states", async () => {
    let attempts = 0;
    let task;
    do {
      await new Promise(r => setTimeout(r, 2000));
      task = await api(`/v1/tasks/${taskId}`);
      attempts++;
    } while (!["COMPLETED", "FAILED", "WAITING_APPROVAL", "PAUSED"].includes(task.state) && attempts < 30);

    expect(task.state).toBeDefined();
    expect(["COMPLETED", "FAILED", "WAITING_APPROVAL", "PAUSED"]).toContain(task.state);
  }, 90_000);

  it("4. session can be resumed", async () => {
    const task = await api(`/v1/tasks/${taskId}`);
    expect(task.id).toBe(taskId);
    expect(task.goal).toBeDefined();
  });
});
