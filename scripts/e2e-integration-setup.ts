/**
 * E2E Integration Setup — starts all services, pairs bridge, creates test data.
 * Used by Playwright tests that require the full Browser → API → Worker → Gateway → Bridge chain.
 *
 * Run: npx tsx scripts/e2e-integration-setup.ts
 * Output: JSON with userId, workspaceId, projectId, bridgeId, deviceToken, etc.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname } from "node:os";
import net from "node:net";

const API_URL = "http://localhost:4000";
const GATEWAY_PORT = 4010;
const FIXTURE_DIR = String.raw`C:\Users\Sridhar\Documents\Default Project\fixtures\hello-app`;
const PROJECT_ROOT = String.raw`C:\Users\Sridhar\Documents\Default Project`;
const CONFIG_DIR = join(homedir(), ".ai-harness-bridge");
const CONFIG_FILE = process.env["AI_HARNESS_BRIDGE_CONFIG"] ?? join(CONFIG_DIR, "config.json");

const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
const password = "TestPass1234";

let apiProc: ChildProcess | undefined;
let gatewayProc: ChildProcess | undefined;
let workerProc: ChildProcess | undefined;
let bridgeProc: ChildProcess | undefined;
let frontendProc: ChildProcess | undefined;

function log(msg: string) { console.log(`[setup] ${msg}`); }

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const s = net.createConnection(port, "127.0.0.1");
      s.once("connect", () => { s.destroy(); resolve(); });
      s.once("error", () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

function startService(name: string, cmd: string, args: string[], cwd: string, env?: Record<string, string>): ChildProcess {
  log(`Starting ${name}...`);
  const proc = spawn(cmd, args, {
    cwd,
    shell: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d) => {
    const line = d.toString().trim();
    if (line.length > 0) log(`[${name}] ${line.slice(0, 200)}`);
  });
  proc.stderr?.on("data", (d) => {
    const line = d.toString().trim();
    if (line.length > 0 && !line.includes("deprecated")) log(`[${name}] ${line.slice(0, 200)}`);
  });
  proc.on("exit", (code) => log(`${name} exited with code ${code}`));
  return proc;
}

async function startServices() {
  // 1. Start API
  apiProc = startService("api", "npx", ["tsx", "src/server.ts"], join(PROJECT_ROOT, "backend/apps/api"));
  await waitForPort(4000);
  log("API ready on :4000");

  // 2. Start Gateway
  gatewayProc = startService("gateway", "npx", ["tsx", "src/server.ts"], join(PROJECT_ROOT, "backend/apps/bridge-gateway"));
  await waitForPort(GATEWAY_PORT);
  log(`Gateway ready on :${GATEWAY_PORT}`);

  // 3. Start Worker
  workerProc = startService("worker", "npx", ["tsx", "src/worker.ts"], join(PROJECT_ROOT, "backend/apps/worker"));
  await new Promise((r) => setTimeout(r, 3000));
  log("Worker started");

  // 4. Start Frontend
  frontendProc = startService("frontend", "npx", ["next", "start", "-p", "3000"], join(PROJECT_ROOT, "frontend"));
  await waitForPort(3000);
  log("Frontend ready on :3000");
}

async function createTestData() {
  // 1. Signup
  log("Creating test user...");
  const signup = await api("/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ displayName: "E2E User", email, password }),
  });
  const userId = signup.data?.id ?? signup.id;
  const accessToken = signup.data?.accessToken ?? signup.accessToken;
  log(`User: ${userId}`);
  const authH = { Authorization: `Bearer ${accessToken}` };

  // 2. Create workspace
  log("Creating workspace...");
  const workspace = await api("/v1/workspaces", {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "E2E Workspace" }),
  });
  const workspaceId = workspace.data?.id ?? workspace.id;
  log(`Workspace: ${workspaceId}`);

  // 3. Create pairing token
  log("Creating pairing token...");
  const tokenResp = await api("/v1/bridges/pairing-tokens", {
    method: "POST",
    headers: authH,
  });
  const pairingToken = tokenResp.data?.pairingToken ?? tokenResp.pairingToken;
  log(`Pairing token obtained`);

  // 4. Pair bridge via API (simulating what the bridge agent does)
  log("Pairing bridge...");
  const pairResp = await api("/v1/bridges/pair", {
    method: "POST",
    body: JSON.stringify({
      pairingToken,
      name: `E2E Bridge (${hostname()})`,
      version: "0.2.0-test",
      capabilities: { filesystem: true, git: true, terminal: true, checkpoints: true },
    }),
  });
  const bridgeId = pairResp.data?.bridgeId ?? pairResp.bridgeId;
  const deviceToken = pairResp.data?.deviceToken ?? pairResp.deviceToken;
  log(`Bridge: ${bridgeId}`);

  // 5. Save bridge config for the bridge agent
  mkdirSync(CONFIG_DIR, { recursive: true });
  const bridgeConfig = {
    apiUrl: API_URL,
    gatewayUrl: `ws://localhost:${GATEWAY_PORT}/bridge`,
    bridgeId,
    deviceToken,
    name: `E2E Bridge (${hostname()})`,
    roots: [{ label: "fixture-hello-app", path: FIXTURE_DIR }],
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(bridgeConfig, null, 2), "utf8");
  log("Bridge config saved");

  // 6. Register project root on bridge via API
  log("Registering project root...");
  try {
    await api(`/v1/bridges/${bridgeId}/project-roots`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({
        displayName: "Hello App Fixture",
        canonicalRootReference: FIXTURE_DIR,
      }),
    });
    log("Project root registered");
  } catch (err) {
    log(`Root registration note: ${(err as Error).message}`);
  }

  // 7. Create project bound to bridge
  log("Creating project...");
  const project = await api(`/v1/workspaces/${workspaceId}/projects`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({
      name: "hello-app",
      rootReference: FIXTURE_DIR,
      connectionType: "LOCAL_BRIDGE",
      bridgeId,
    }),
  });
  const projectId = project.data?.id ?? project.id;
  log(`Project: ${projectId}`);

  // 8. Create TEST provider
  log("Creating TEST provider...");
  const provider = await api("/v1/providers", {
    method: "POST",
    headers: authH,
    body: JSON.stringify({
      providerType: "TEST",
      displayName: "E2E Test Provider",
      credential: "plan-then-execute",
    }),
  });
  const providerId = provider.data?.id ?? provider.id;
  log(`Provider: ${providerId}`);

  // 9. Link provider to workspace
  log("Linking provider to workspace...");
  try {
    await api(`/v1/workspaces/${workspaceId}/providers`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ providerConnectionId: providerId }),
    });
  } catch (err) {
    log(`Provider link note: ${(err as Error).message}`);
  }

  // 10. Create model routes for all stages
  log("Creating model routes...");
  try {
    await api(`/v1/workspaces/${workspaceId}/model-routes`, {
      method: "PUT",
      headers: authH,
      body: JSON.stringify({
        routes: [
          { stage: "PLANNING", providerConnectionId: providerId, modelIdentifier: "test-model", priority: 1 },
          { stage: "IMPLEMENTATION", providerConnectionId: providerId, modelIdentifier: "test-model", priority: 1 },
          { stage: "REVIEW", providerConnectionId: providerId, modelIdentifier: "test-model", priority: 1 },
        ],
      }),
    });
    log("Model routes created");
  } catch (err) {
    log(`Model routes note: ${(err as Error).message}`);
  }

  // 11. Start bridge agent
  log("Starting bridge agent...");
  bridgeProc = startService("bridge", "npx", ["tsx", "src/agent.ts", "run"], join(PROJECT_ROOT, "local_bridge"), {
    AI_HARNESS_BRIDGE_CONFIG: CONFIG_FILE,
  });
  await new Promise((r) => setTimeout(r, 5000));
  log("Bridge agent started");

  return {
    userId,
    accessToken,
    workspaceId,
    projectId,
    bridgeId,
    deviceToken,
    providerId,
    email,
    password: "TestPass1234",
    fixtureDir: FIXTURE_DIR,
  };
}

async function cleanup() {
  log("Cleaning up...");
  bridgeProc?.kill("SIGTERM");
  frontendProc?.kill("SIGTERM");
  workerProc?.kill("SIGTERM");
  gatewayProc?.kill("SIGTERM");
  apiProc?.kill("SIGTERM");
}

async function main() {
  try {
    await startServices();
    const data = await createTestData();
    const outputPath = join(PROJECT_ROOT, "test-results", "e2e-context.json");
    mkdirSync(join(PROJECT_ROOT, "test-results"), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
    log(`Context saved to ${outputPath}`);
    log("Setup complete. Services are running.");
    log("Press Ctrl+C to stop all services.");

    // Keep alive until killed
    process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
    process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
  } catch (err) {
    console.error("Setup failed:", err);
    await cleanup();
    process.exit(1);
  }
}

main();
