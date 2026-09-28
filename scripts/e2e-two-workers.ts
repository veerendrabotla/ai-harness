/**
 * Multi-worker resilience check: runs TWO workers against the same queue,
 * bursts task creation, then asserts:
 *  - every task reaches a terminal state
 *  - every task has EXACTLY ONE run (FR-012 / no double execution)
 */
import { spawn, execSync } from "node:child_process";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4000";
const TASKS = Number(process.argv[3] ?? 6);

async function call(method: string, path: string, opts: { token?: string; json?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function log(m: string): void { console.log(`[resilience] ${m}`); }

async function main(): Promise<void> {
  const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const spawnWorker = (): ReturnType<typeof spawn> =>
    spawn(process.execPath, [TSX_CLI, "backend/apps/worker/src/worker.ts"], {
      stdio: ["ignore", "ignore", "ignore"],
      cwd: resolve(process.cwd()),
    });

  const workers = [spawnWorker(), spawnWorker()];
  log("two workers started");

  const email = `res-${Date.now()}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", {
    json: { email, password: "Resilience123", displayName: "Resilience" },
  });
  const token: string = signup.body.data.accessToken;

  const ws = await call("POST", "/v1/workspaces", { token, json: { name: "Resil WS" } });
  const workspaceId: string = ws.body.data.id;
  const proj = await call("POST", `/v1/workspaces/${workspaceId}/projects`, {
    token,
    json: { name: "r", connectionType: "CLOUD", rootReference: "res" },
  });
  const projectId: string = proj.body.data.id;

  // Dead provider + route → runs fail fast after their event stream.
  const prov = await call("POST", "/v1/providers", {
    token,
    json: { providerType: "OPENAI_COMPATIBLE", displayName: "dead", credential: "x".repeat(12), metadata: { baseUrl: "http://127.0.0.1:9/v1" } },
  });
  await call("PUT", `/v1/workspaces/${workspaceId}/model-routes`, {
    token,
    json: { routes: [{ stage: "PLANNING", providerConnectionId: prov.body.data.id, modelIdentifier: "m", priority: 10, active: true }] },
  });

  log(`burst-creating ${TASKS} tasks…`);
  const created: string[] = [];
  for (let i = 0; i < TASKS; i++) {
    const t = await call("POST", "/v1/tasks", {
      token,
      json: { workspaceId, projectId, goal: `resilience task ${i}`, selectedModelMode: "ROUTED" },
    });
    if (t.status === 201) created.push(t.body.data.id);
  }
  log(`${created.length} tasks queued`);

  // Wait until all terminal.
  const deadline = Date.now() + 180_000;
  let states: Record<string, string> = {};
  while (Date.now() < deadline) {
    states = {};
    for (const id of created) {
      const t = await call("GET", `/v1/tasks/${id}`, { token });
      states[id] = t.body?.data?.state ?? "?";
    }
    if (Object.values(states).every((s) => ["COMPLETED", "FAILED", "CANCELLED"].includes(s))) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  let failures = 0;
  for (const id of created) {
    const runs = await call("GET", `/v1/tasks/${id}/runs`, { token });
    const runList = runs.body?.data ?? [];
    if (runList.length !== 1) { failures++; log(`FAIL ${id}: ${runList.length} runs`); continue; }
    if (!["COMPLETED", "FAILED"].includes(runList[0].state)) { failures++; log(`FAIL ${id}: state ${runList[0].state}`); }
  }

  for (const w of workers) w.kill();

  if (failures > 0) throw new Error(`${failures} resilience checks failed`);
  console.log("\nRESILIENCE RESULT: ✅ all tasks terminal with exactly one run each");
}

main().catch((e) => { console.error("RESILIENCE FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
