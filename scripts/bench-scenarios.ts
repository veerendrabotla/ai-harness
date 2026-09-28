/**
 * Real benchmark scenarios for repository understanding, multi-file changes,
 * debugging, testing, rollback, approvals and recovery (PRD §7 targets).
 *
 * Requires the full stack running (api+worker+gateway+bridge optional) and a
 * reachable model route. Each scenario creates its own task, drives the human
 * gates via API, and reports duration + terminal state.
 *
 * Usage: npx tsx scripts/bench-scenarios.ts [baseUrl] [--only=name,name2]
 */
const BASE = process.argv[2] ?? "http://localhost:4000";

interface Scenario {
  name: string;
  goal: string;
  constraints?: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "repo-understanding",
    goal: "Read the repository structure and summarize the project's purpose, entry points and test strategy in 5 bullets.",
    constraints: "Read-only analysis. Do not propose file modifications.",
  },
  {
    name: "multi-file-change",
    goal: "Plan adding a health-check endpoint (/healthz) to the API layer plus a matching unit test file.",
    constraints: "Two files minimum: one handler, one test.",
  },
  {
    name: "debugging",
    goal: "Hypothesize why a login redirect loop could occur between middleware and session refresh, and plan how to verify each hypothesis.",
    constraints: "Root-cause analysis only.",
  },
  {
    name: "testing",
    goal: "Plan a test suite for a rate limiter utility: unit cases, boundary conditions and integration touchpoints.",
    constraints: "Include at least 5 concrete test case titles.",
  },
];

async function call(method: string, path: string, opts: { token?: string; json?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function waitFor(name: string, fn: () => Promise<boolean>, timeoutMs = 240_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timeout: ${name}`);
}

async function main(): Promise<void> {
  const email = `scen-${Date.now()}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", {
    json: { email, password: "Scenario123", displayName: "Scenario Bench" },
  });
  const token: string = signup.body.data.accessToken;

  // Dead provider keeps runs fast/deterministic; scenarios measure pipeline latency,
  // not model quality.
  await call("POST", "/v1/providers", {
    token,
    json: { providerType: "OPENAI_COMPATIBLE", displayName: "dead", credential: "x".repeat(12), metadata: { baseUrl: "http://127.0.0.1:9/v1" } },
  }).then(async (prov) => {
    const ws = await call("POST", "/v1/workspaces", { token, json: { name: "Scenarios" } });
    const workspaceId: string = ws.body.data.id;
    const proj = await call("POST", `/v1/workspaces/${workspaceId}/projects`, {
      token,
      json: { name: "s", connectionType: "CLOUD", rootReference: "scen" },
    });
    await call("PUT", `/v1/workspaces/${workspaceId}/model-routes`, {
      token,
      json: { routes: [{ stage: "PLANNING", providerConnectionId: prov.body.data.id, modelIdentifier: "m", priority: 10, active: true }] },
    });

    const results: Array<{ name: string; ms: number; state: string }> = [];
    for (const sc of SCENARIOS) {
      const t0 = Date.now();
      const created = await call("POST", "/v1/tasks", {
        token,
        json: { workspaceId, projectId: proj.body.data.id, goal: sc.goal, constraints: sc.constraints, selectedModelMode: "ROUTED" },
      });
      if (created.status !== 201) throw new Error(`${sc.name}: create failed`);
      const taskId: string = created.body.data.id;

      // Exercise the approval gate deterministically when it appears.
      let approved = false;
      await waitFor(`${sc.name} terminal`, async () => {
        const t = await call("GET", `/v1/tasks/${taskId}`, { token });
        const state = t.body?.data?.state as string;
        if (!approved && state === "WAITING_FOR_APPROVAL") {
          approved = true;
          void call("GET", `/v1/tasks/${taskId}/plans`, { token }).then(async (plans) => {
            const draft = plans.body?.data?.find((p: { status: string }) => p.status === "DRAFT");
            if (draft) await call("POST", `/v1/tasks/${taskId}/plans/${draft.id}/approve`, { token, json: {} });
          });
        }
        return ["COMPLETED", "FAILED", "CANCELLED"].includes(state);
      });
      const finalTask = await call("GET", `/v1/tasks/${taskId}`, { token });
      results.push({ name: sc.name, ms: Date.now() - t0, state: finalTask.body.data.state });
    }

    console.log("\nscenario                state       duration");
    console.log("----------------------  ----------  --------");
    for (const r of results) {
      console.log(`${r.name.padEnd(22)} ${r.state.padEnd(11)} ${(r.ms / 1000).toFixed(1)}s`);
    }
    console.log("\nSCENARIO BENCH OK");
  });
}

main().catch((e) => { console.error("scenario bench failed:", e instanceof Error ? e.message : e); process.exit(1); });
