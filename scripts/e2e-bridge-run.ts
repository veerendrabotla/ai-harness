/**
 * Bridge execution E2E: gateway + local-bridge agent + real filesystem/git.
 * Verifies: pairing → CONNECTED → confined inspection → checkpoint create →
 * rollback restores modified content.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4000";
const ROOT = process.env.AI_HARNESS_GATEWAY_URL?.replace("ws://", "http://").replace("/bridge", "") ?? "http://localhost:4010";

// Load repo .env for BRIDGE_INTERNAL_TOKEN
for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const INTERNAL_TOKEN = process.env.BRIDGE_INTERNAL_TOKEN ?? "";

function log(s: string): void {
  console.log(`[e2e] ${s}`);
}

async function call(method: string, path: string, opts: { token?: string; json?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

async function waitFor(name: string, fn: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timeout waiting for ${name}`);
}

async function gatewayExecute(bridgeId: string, kind: string, params: Record<string, unknown>) {
  const res = await fetch(`${ROOT}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": INTERNAL_TOKEN },
    body: JSON.stringify({ bridgeId, request: { id: `${Date.now()}-${Math.random()}`, kind, params, timeoutMs: 30_000 } }),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } };
}

const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(-pid);
  } catch { /* already gone */ }
}

function tsx(script: string, args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof spawn> {
  return spawn(process.execPath, [TSX_CLI, script, ...args], {
    cwd: resolve(process.cwd()),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

async function main(): Promise<void> {
  // 0. Gateway up?
  let gwUp = false;
  try { gwUp = ((await fetch(`${ROOT}/healthz`)).status === 200); } catch { /* down */ }
  if (!gwUp) {
    log("starting gateway…");
    const gw = tsx("backend/apps/bridge-gateway/src/server.ts", []);
    gw.stdout?.on("data", () => undefined);
    await waitFor("gateway healthz", async () => {
      try { return (await fetch(`${ROOT}/healthz`)).status === 200; } catch { return false; }
    }, 30_000);
  }
  log("gateway ready");

  // 1. Temp git repo root
  const root = join(tmpdir(), `ah-e2e-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  execSync("git init -q", { cwd: root });
  execSync('git -c user.email=e2e@test -c user.name=e2e commit -q --allow-empty -m init', { cwd: root });
  writeFileSync(join(root, "demo.txt"), "original-content\n", "utf8");
  execSync("git add -A", { cwd: root });
  execSync("git -c user.email=e2e@test -c user.name=e2e commit -q -m seed", { cwd: root });
  log(`temp repo at ${root}`);

  // 2. Account + workspace
  const email = `br-${Date.now()}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", {
    json: { email, password: "BridgePass123", displayName: "Bridge Tester" },
  });
  const token: string = signup.body.data.accessToken;

  const ws = await call("POST", "/v1/workspaces", { token, json: { name: "Bridge WS" } });
  const workspaceId: string = ws.body.data.id;

  // 3. Pairing token → agent pair → register root → run agent
  const pt = await call("POST", "/v1/bridges/pairing-tokens", { token, json: {} });
  const pairingToken: string = pt.body.data.pairingToken;

  const pairProc = tsx("local_bridge/src/agent.ts", ["pair", "--token", pairingToken]);
  await new Promise((r) => { pairProc.on("close", r); pairProc.stdout?.on("data", () => undefined); });
  log("agent paired");

  const addProc = tsx("local_bridge/src/agent.ts", ["add-root", root, "e2e-root"]);
  await new Promise((r) => { addProc.on("close", r); });

  const agent = tsx("local_bridge/src/agent.ts", ["run"]);
  agent.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
  log("agent running");

  // 4. Wait for CONNECTED
  await waitFor("bridge CONNECTED", async () => {
    const bridges = await call("GET", "/v1/bridges", { token });
    return (bridges.body.data ?? []).some((b: { status: string }) => b.status === "CONNECTED");
  }, 45_000);
  const bridges = await call("GET", "/v1/bridges", { token });
  const bridgeId: string = bridges.body.data.find((b: { status: string }) => b.status === "CONNECTED").id;
  log("bridge CONNECTED");

  // Owner registers the canonical root with the backend (device tokens are gateway-credentials).
  const reg = await call("POST", `/v1/bridges/${bridgeId}/project-roots`, {
    token,
    json: { displayName: "e2e-root", canonicalRootReference: root },
  });
  if (reg.status !== 201) throw new Error("root registration failed: " + JSON.stringify(reg.body).slice(0, 200));
  log("root registered");


  // 5. Project bound to registered root
  const proj = await call("POST", `/v1/workspaces/${workspaceId}/projects`, {
    token,
    json: { name: "e2e-repo", connectionType: "LOCAL_BRIDGE", bridgeId, rootReference: root },
  });
  if (proj.status !== 201) throw new Error(`project failed: ${JSON.stringify(proj.body).slice(0, 200)}`);
  const projectId: string = proj.body.data.id;
  log("LOCAL_BRIDGE project created");

  // 6. Confined inspection via the API (git.status)
  const status = await call("POST", `/v1/projects/${projectId}/inspect`, { token, json: { op: "git.status" } });
  const st = status.body?.data as { branch?: string; clean?: boolean } | undefined;
  if (status.status !== 200 || !st?.branch || st.clean !== true) {
    throw new Error(`git.status unexpected: ${JSON.stringify(status.body).slice(0, 250)}`);
  }
  log(`inspect git.status OK — branch ${st.branch}, clean tree`);

  // Traversal attempt must be denied by the BRIDGE itself
  const traversal = await gatewayExecute(bridgeId, "fs.read", { root, path: "../../../windows/win.ini" });
  if (traversal.body.ok !== false) throw new Error("traversal was NOT rejected!");
  log("traversal rejected by bridge ✓");

  // 7. Checkpoint create → modify → diff shows change → rollback restores
  const cp = await gatewayExecute(bridgeId, "ckpt.create", { root });
  if (!cp.body.ok) throw new Error(`ckpt.create failed: ${JSON.stringify(cp.body.error)}`);
  const stateRef = cp.body.data as { kind: string; headBefore: string; ref: string; createdStash: boolean };
  log(`checkpoint created (stash=${stateRef.createdStash})`);

  writeFileSync(join(root, "demo.txt"), "AGENT-MODIFIED\n", "utf8");
  const diffResp = await gatewayExecute(bridgeId, "git.diff", { root, staged: false });
  if (!String(diffResp.body.data?.diff ?? "").includes("AGENT-MODIFIED")) throw new Error("diff missing modification");
  log("git.diff shows agent modification ✓");

  const rb = await gatewayExecute(bridgeId, "ckpt.rollback", { root, ref: stateRef.ref });
  if (!rb.body.ok) throw new Error(`rollback failed: ${JSON.stringify(rb.body.error)}`);
  const restored = readFileSync(join(root, "demo.txt"), "utf8");
  if (!restored.includes("original-content")) throw new Error("rollback did not restore original content");
  log("rollback RESTORED original content ✓");

  // ── STDIO MCP discovery through the bridge ──
  const fakeServerPath = resolve(process.cwd(), "local_bridge", "fake-mcp-server.mjs");
  const mcpCreate = await call("POST", "/v1/mcp/servers", {
    token,
    json: { name: "e2e-fake-mcp", transportType: "STDIO", config: { command: process.execPath, args: [fakeServerPath] } },
  });
  if (mcpCreate.status !== 201) throw new Error(`mcp create failed: ${JSON.stringify(mcpCreate.body).slice(0, 200)}`);
  const mcpId: string = mcpCreate.body.data.id;

  const enable = await call("POST", `/v1/workspaces/${workspaceId}/mcp/${mcpId}/enable`, { token, json: {} });
  if (enable.status !== 200) throw new Error(`mcp enable failed: ${JSON.stringify(enable.body).slice(0, 200)}`);

  const servers = await call("GET", "/v1/mcp/servers", { token });
  const srv = (servers.body.data ?? []).find((s: { id: string }) => s.id === mcpId);
  if (srv?.status !== "ACTIVE") throw new Error(`STDIO discovery failed — status=${srv?.status}`);
  log("STDIO MCP discovery via bridge ✓ (status ACTIVE)");
  console.log("\nBRIDGE E2E RESULT: ✅ ALL CHECKS PASSED");
  killTree(agent.pid);
  rmSync(root, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 300);
}

main().catch((err) => {
  console.error("BRIDGE E2E FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
