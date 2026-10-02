/**
 * Full vertical-slice E2E against a RUNNING api + worker + a real model provider.
 * Drives: signup -> workspace -> project -> provider -> route -> task ->
 * QUEUED..PLANNING -> WAITING_FOR_APPROVAL -> approve -> EXECUTING..terminal.
 * Requires the docker sandbox layer so CLOUD tools can execute:
 *   docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
 * The project root is seeded under .data/workspaces on the host so the
 * worker-side sandbox container can mount it (PHASE 13 #11).
 * Usage: npx tsx scripts/e2e-agent-run.ts [baseUrl] [model]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const BASE = process.argv[2] ?? "http://localhost:4000";
const MODEL = process.argv[3] ?? "qwen2.5:3b";
const PROVIDER_BASE = process.env.E2E_PROVIDER_BASE ?? "http://host.docker.internal:11434/v1";

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
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

function log(step: string, detail?: unknown) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step}`, detail !== undefined ? JSON.stringify(detail).slice(0, 220) : "");
}

async function waitFor(
  name: string,
  fn: () => Promise<{ done: boolean; detail?: unknown }>,
  timeoutMs = 180_000,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: unknown;
  while (Date.now() < deadline) {
    const r = await fn();
    lastDetail = r.detail;
    if (r.done) return r.detail;
    await new Promise((res) => setTimeout(res, 2500));
  }
  throw new Error(`Timed out waiting for ${name}; last=${JSON.stringify(lastDetail).slice(0, 300)}`);
}

function seedProjectWorkspace(): string {
  const dir = path.resolve(process.cwd(), ".data", "workspaces", `e2e-agent-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "e2e-demo",
        version: "0.0.1",
        private: true,
        scripts: { test: "node -e \"console.log('ok: no tests yet')" },
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "README.md"),
    "# e2e-demo\n\nSeed project for the AI Harness agent E2E. Run `npm test` to verify.\n",
  );
  // Seed the repo wiki so the afterComplete maintainer has a presence-gated
  // target: a COMPLETED run must rewrite changelog.md + index.md here.
  fs.mkdirSync(path.join(dir, ".aiharness", "wiki", "pages"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".aiharness", "wiki", "index.md"),
    "# e2e-demo wiki\n\nSeeded by the agent E2E; regenerated after the first completed run.\n",
  );
  fs.writeFileSync(
    path.join(dir, ".aiharness", "wiki", "pages", "about.md"),
    "# About\n\nTiny seed topic page so the generated index has a TOC entry.\n",
  );
  try {
    execSync("git init -q && git add -A && git -c user.email=e2e@local -c user.name=e2e commit -qm init", {
      cwd: dir,
      stdio: "ignore",
    });
  } catch {
    // git metadata is best-effort; the seed files are what matter for sandbox E2E
  }
  return dir;
}

async function main() {
  // 1. Auth
  const email = `e2e-${Date.now()}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", {
    json: { email, password: "E2ePass1234", displayName: "E2E Runner" },
  });
  if (signup.status !== 201) throw new Error(`signup failed: ${JSON.stringify(signup.body)}`);
  const token: string = signup.body.data.accessToken;
  log("signed up", { email });

  // 2. Workspace + project — seed a tiny real repo the sandbox can mount and
  // "verify" (npm test passes inside the ephemeral container, --network none).
  const wsDir = seedProjectWorkspace();
  const ws = await call("POST", "/v1/workspaces", {
    token,
    json: { name: "E2E Workspace", executionMode: "CLOUD" },
  });
  const workspaceId: string = ws.body.data.id;
  const project = await call("POST", `/v1/workspaces/${workspaceId}/projects`, {
    token,
    json: { name: "demo-repo", connectionType: "CLOUD", rootReference: wsDir },
  });
  const projectId: string = project.body.data.id;
  log("workspace+project ready", { workspaceId, rootReference: wsDir });

  // 3. Provider connection (OpenAI-compatible local endpoint) + health test
  const provider = await call("POST", "/v1/providers", {
    token,
    json: {
      providerType: "OPENAI_COMPATIBLE",
      displayName: "Local Ollama",
      credential: "not-required-locally",
      metadata: { baseUrl: PROVIDER_BASE },
    },
  });
  const providerId: string = provider.body.data.id;
  log("provider connected", { id: providerId, test: provider.body.data.test?.detail, ok: provider.body.data.test?.ok });

  // 4. Model route for PLANNING stage
  const routes = await call("PUT", `/v1/workspaces/${workspaceId}/model-routes`, {
    token,
    json: {
      routes: [
        { stage: "PLANNING", providerConnectionId: providerId, modelIdentifier: MODEL, priority: 10, active: true },
        { stage: "IMPLEMENTATION", providerConnectionId: providerId, modelIdentifier: MODEL, priority: 10, active: true },
      ],
    },
  });
  if (routes.status !== 200) throw new Error(`route setup failed: ${JSON.stringify(routes.body)}`);
  log("model routes configured", { stage: ["PLANNING", "IMPLEMENTATION"], model: MODEL });

  // 5. Create task
  const task = await call("POST", "/v1/tasks", {
    token,
    json: {
      workspaceId,
      projectId,
      goal:
        "Append a section titled 'Running the tests' to the existing README.md explaining how to run the test suite (npm test). " +
        "README.md already exists — edit only it; do not create or reference any other files.",
      constraints:
        "Documentation only; do not propose code changes. Work only with README.md (never README.rst or new files). " +
        "Verification must be `npm test` (it passes). Keep git commands simple (use `--` before path arguments).",
      selectedModelMode: "ROUTED",
    },
  });
  if (task.status !== 201) throw new Error(`task creation failed: ${JSON.stringify(task.body)}`);
  const taskId: string = task.body.data.id;
  log("task created", { taskId });

  // 6. Wait for WAITING_FOR_APPROVAL
  await waitFor("WAITING_FOR_APPROVAL", async () => {
    const t = await call("GET", `/v1/tasks/${taskId}`, { token });
    return { done: t.body.data.state === "WAITING_FOR_APPROVAL", detail: t.body.data.state };
  }, 240_000);
  log(">>> task reached WAITING_FOR_APPROVAL");

  const plans = await call("GET", `/v1/tasks/${taskId}/plans`, { token });
  const draftPlan = plans.body.data.find((p: { status: string }) => p.status === "DRAFT");
  log("plan drafted", {
    version: draftPlan?.version,
    steps: draftPlan?.steps?.length,
    analysis: draftPlan?.analysis?.slice(0, 120),
  });

  // 7. Approve
  const approve = await call("POST", `/v1/tasks/${taskId}/plans/${draftPlan.id}/approve`, { token, json: {} });
  if (approve.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approve.body)}`);
  log("plan approved by human");

  // 8. Wait for a terminal state. Small local models occasionally emit a bad
  // verification/step command, which triggers failure-driven replanning and a
  // fresh DRAFT — re-approve like a human babysitting the run would (max 4).
  let approvedVersion: number = draftPlan.version;
  let approvals = 1;
  const finalState = (await waitFor("terminal state", async () => {
    const t = await call("GET", `/v1/tasks/${taskId}`, { token });
    const s = t.body.data.state as string;
    if (s === "WAITING_FOR_APPROVAL" && approvals < 4) {
      const ps = await call("GET", `/v1/tasks/${taskId}/plans`, { token });
      const draft = (ps.body.data ?? []).find(
        (p: { status: string; version: number }) => p.status === "DRAFT" && p.version !== approvedVersion,
      );
      if (draft) {
        approvals++;
        approvedVersion = draft.version;
        log(`re-approving plan v${draft.version} after replan (attempt ${approvals}/4)`);
        await call("POST", `/v1/tasks/${taskId}/plans/${draft.id}/approve`, { token, json: {} });
      }
      return { done: false, detail: s };
    }
    const done = ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(s);
    return { done, detail: s };
  }, 600_000)) as string;
  log(`>>> task reached ${finalState}`);

  // 8b. Repo wiki (PHASE 14 #1): the workspace seeds .aiharness/wiki/, so a
  // COMPLETED run's afterComplete hook must refresh changelog + index. The
  // seeded index.md exists from t=0, so poll its CONTENT, not existence.
  if (finalState === "COMPLETED") {
    const wikiDir = path.join(wsDir, ".aiharness", "wiki");
    const changelog = path.join(wikiDir, "changelog.md");
    const index = path.join(wikiDir, "index.md");
    await waitFor("wiki changelog", async () => ({ done: fs.existsSync(changelog) }), 60_000);
    await waitFor(
      "wiki index refresh",
      async () => {
        if (!fs.existsSync(index)) return { done: false };
        const idx = fs.readFileSync(index, "utf8");
        return { done: idx.includes("## Recent runs") && idx.includes("Running the tests") };
      },
      60_000,
    );
    const cl = fs.readFileSync(changelog, "utf8");
    if (!cl.includes("<!-- run:")) throw new Error("wiki changelog lacks the run idempotency marker");
    if (!cl.includes("Running the tests")) throw new Error("wiki changelog lacks the task goal");
    const idx = fs.readFileSync(index, "utf8");
    if (!idx.includes("about")) throw new Error("wiki index lacks the seeded topic page");
    if (!idx.includes("Running the tests")) throw new Error("wiki index lacks the recent-runs entry");
    log(">>> wiki maintained (changelog.md + index.md refreshed by afterComplete)");
  } else {
    log(">>> wiki check skipped (run did not complete)", finalState);
  }

  // 9. Print event timeline
  const events = await call("GET", `/v1/tasks/${taskId}/events?limit=500`, { token });
  console.log("\n════ EVENT TIMELINE ════");
  for (const e of events.body.data) {
    console.log(
      `${String(e.sequenceNumber).padStart(3)} ${e.eventType.padEnd(28)} (${e.actorType.toLowerCase()})`,
    );
  }

  const runs = await call("GET", `/v1/tasks/${taskId}/runs`, { token });
  console.log("\n════ RUNS ════");
  for (const r of runs.body.data) {
    console.log(`run#${r.runNumber} state=${r.state} failureCode=${r.failureCode ?? "-"}`);
  }

  const verifications = await call("GET", `/v1/tasks/${taskId}/verification`, { token });
  console.log("\n════ VERIFICATION ════");
  for (const v of verifications.body.data) {
    console.log(`${v.status.padEnd(7)} ${v.command}`);
  }

  console.log(`\nE2E RESULT: ${finalState === "COMPLETED" ? "✅ COMPLETED" : `⚠️ ${finalState}`}`);
}

main().catch((err) => {
  console.error("E2E crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
