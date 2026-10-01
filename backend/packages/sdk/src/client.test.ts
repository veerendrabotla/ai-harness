import { describe, it, expect, vi, afterEach } from "vitest";
import { AiHarnessClient, SDKError } from "./client.js";

type Call = { url: string; method: string; body?: unknown };

function firstCall<T>(calls: T[]): T {
  const first = calls[0];
  if (first === undefined) throw new Error("expected at least one fetch call");
  return first;
}

function jsonResponse(payload: unknown, status = 200): Record<string, unknown> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
  };
}

function routeMock(routes: (call: Call, index: number) => unknown) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return jsonResponse(routes(call, calls.length - 1));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const client = () => new AiHarnessClient({ baseUrl: "http://api.test", timeoutMs: 5_000, maxRetries: 0 });

describe("createTask", () => {
  it("auto-derives workspaceId from the project when omitted", async () => {
    const { calls } = routeMock((call) => {
      if (call.url.includes("/v1/projects/p1")) return { data: { id: "p1", workspaceId: "ws1" } };
      if (call.url.endsWith("/v1/tasks")) return { data: { id: "t1", state: "QUEUED" } };
      throw new Error(`unexpected ${call.url}`);
    });
    const task = await client().createTask({ goal: "do the thing", projectId: "p1", agentMode: "BUILD" });
    expect(task.id).toBe("t1");
    expect(calls).toHaveLength(2);
    expect(firstCall(calls).url).toContain("/v1/projects/p1");
    expect(firstCall(calls.slice(1)).method).toBe("POST");
    expect(firstCall(calls.slice(1)).body).toMatchObject({ goal: "do the thing", projectId: "p1", workspaceId: "ws1" });
  });

  it("passes an explicit workspaceId through without a project lookup", async () => {
    const { calls } = routeMock((call) => {
      expect(call.url.endsWith("/v1/tasks")).toBe(true);
      return { data: { id: "t1", state: "QUEUED" } };
    });
    await client().createTask({ goal: "x", projectId: "p1", workspaceId: "ws2" });
    expect(calls).toHaveLength(1);
    expect(firstCall(calls).body).toMatchObject({ workspaceId: "ws2" });
  });

  it("rejects a missing projectId before any network call", async () => {
    const { fetchMock } = routeMock(() => ({ data: {} }));
    const err = await client()
      .createTask({ goal: "x", projectId: undefined as unknown as string })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SDKError);
    expect((err as SDKError).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("plans", () => {
  it("revisePlan sends the singular `instruction` body key the API requires", async () => {
    const { calls } = routeMock(() => ({ data: { taskState: "PLANNING" } }));
    await client().revisePlan("t1", "pl1", "also add docs");
    expect(firstCall(calls).url).toContain("/v1/tasks/t1/plans/pl1/revise");
    expect(firstCall(calls).body).toEqual({ instruction: "also add docs" });
  });
});

describe("memory", () => {
  it("queryMemory uses the plural /memories route and unwraps {memories}", async () => {
    const { calls } = routeMock(() => ({ data: { memories: [{ id: "m1", key: "k" }] } }));
    const result = await client().queryMemory("p1", "billing");
    expect(firstCall(calls).url).toContain("/v1/projects/p1/memories");
    expect(firstCall(calls).url).toContain("q=billing");
    expect(result).toEqual([{ id: "m1", key: "k" }]);
  });

  it("addMemory posts the API body shape to /memories", async () => {
    const { calls } = routeMock(() => ({ data: { id: "m1", key: "conventions" } }));
    const body = { category: "DECISION", key: "conventions", value: "use vitest", context: "team" };
    const entry = await client().addMemory("p1", body);
    expect(firstCall(calls).url).toContain("/v1/projects/p1/memories");
    expect(firstCall(calls).method).toBe("POST");
    expect(firstCall(calls).body).toMatchObject(body);
    expect(entry.id).toBe("m1");
  });
});

describe("checkpoints", () => {
  it("rollbackCheckpoint hits /rollback with confirm:true", async () => {
    const { calls } = routeMock(() => ({ data: { checkpointId: "c1", restored: true } }));
    await client().rollbackCheckpoint("c1");
    expect(firstCall(calls).url).toContain("/v1/checkpoints/c1/rollback");
    expect(firstCall(calls).method).toBe("POST");
    expect(firstCall(calls).body).toEqual({ confirm: true });
  });
});

describe("listTasks", () => {
  it("lists tasks via GET /v1/tasks with the workspaceId query", async () => {
    const { calls } = routeMock(() => ({ data: [{ id: "t1", state: "COMPLETED" }] }));
    const tasks = await client().listTasks("ws1", { state: "COMPLETED", limit: 10 });
    expect(firstCall(calls).url).toContain("/v1/tasks?");
    expect(firstCall(calls).url).toContain("workspaceId=ws1");
    expect(firstCall(calls).url).toContain("state=COMPLETED");
    expect(firstCall(calls).url).toContain("limit=10");
    expect(tasks).toHaveLength(1);
  });
});

describe("streamEvents", () => {
  it("paginates with afterSequence and stops on INTERRUPTED", async () => {
    const events = [
      { id: "e1", sequenceNumber: 1, eventType: "RUN_STARTED", actorType: "SYSTEM", payload: null, createdAt: "2026-01-01T00:00:00Z" },
      { id: "e2", sequenceNumber: 2, eventType: "PLAN_CREATED", actorType: "AGENT", payload: {}, createdAt: "2026-01-01T00:00:01Z" },
    ];
    let taskPolls = 0;
    const { calls } = routeMock((call) => {
      if (call.url.includes("/events")) {
        if (call.url.includes("afterSequence")) return { data: [] };
        return { data: events };
      }
      taskPolls += 1;
      return { data: { state: taskPolls === 1 ? "EXECUTING" : "INTERRUPTED" } };
    });

    const seen: string[] = [];
    for await (const event of client().streamEvents("t1", 1)) seen.push(event.id);
    expect(seen).toEqual(["e1", "e2"]);

    const eventCalls = calls.filter((c) => c.url.includes("/events"));
    expect(eventCalls.length).toBeGreaterThanOrEqual(2);
    expect(firstCall(eventCalls.slice(1)).url).toContain("afterSequence=2");
    const taskCalls = calls.filter((c) => c.url.endsWith("/v1/tasks/t1"));
    expect(taskCalls.length).toBe(2);
  });
});

describe("SDKError", () => {
  it("extracts message and code from the API error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ error: { code: "NOT_FOUND", message: "Project not found" }, requestId: "r1" }),
      })),
    );
    const err = await client()
      .listTasks("ws-bogus")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SDKError);
    expect((err as SDKError).status).toBe(404);
    expect((err as SDKError).message).toBe("Project not found");
    expect((err as SDKError).code).toBe("NOT_FOUND");
    expect((err as SDKError).body).toMatchObject({ requestId: "r1" });
  });
});
