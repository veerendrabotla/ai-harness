/**
 * Multi-replica realtime proof: TWO API instances sharing one Redis.
 *
 * Worker/runtime events reach clients through Redis pub/sub (TASK_EVENTS_CHANNEL),
 * so fan-out must work across API replicas — not just inside one process.
 * This script:
 *  1. spawns a second API instance on REPLICA_PORT,
 *  2. connects Socket.IO clients to BOTH instances (plus a non-subscribed control client),
 *  3. subscribes to the same task room on both replicas,
 *  4. publishes a worker-style event straight to Redis,
 *  5. asserts BOTH subscribed clients receive `task:event` and the control client does not.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Redis } from "ioredis";
import { ensureEnvLoaded, getEnv, TASK_EVENTS_CHANNEL } from "@ai-harness/shared";

const PRIMARY = process.argv[2] ?? "http://127.0.0.1:4000";
const REPLICA_PORT = Number(process.argv[3] ?? 4001);
const REPLICA_BASE = `http://127.0.0.1:${REPLICA_PORT}`;
const RECEIVE_TIMEOUT_MS = 8000;

function log(m: string): void {
  console.log(`[replicas] ${m}`);
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; base?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${opts.base ?? PRIMARY}${path}`, {
    method,
    headers: {
      ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function waitForHealth(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 503) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${base} did not become healthy: ${lastErr}`);
}

function connect(base: string, token: string): Socket {
  return io(base, { auth: { token }, reconnection: false, timeout: 5000 });
}

function waitForEvent(socket: Socket, taskId: string, marker: string): Promise<void> {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      socket.off("task:event", handler);
      rej(new Error(`no task:event within ${RECEIVE_TIMEOUT_MS}ms`));
    }, RECEIVE_TIMEOUT_MS);
    function handler(event: unknown): void {
      const e = event as { eventType?: string; payload?: Record<string, unknown> } | null;
      if (
        e?.eventType === "TOOL_STARTED" &&
        e.payload?.["probe"] === marker
      ) {
        clearTimeout(timer);
        socket.off("task:event", handler);
        res();
      }
    }
    socket.on("task:event", handler);
  });
}

function refuteEvent(socket: Socket, marker: string): Promise<void> {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      socket.off("task:event", handler);
      res();
    }, RECEIVE_TIMEOUT_MS);
    function handler(event: unknown): void {
      const e = event as { payload?: Record<string, unknown> } | null;
      if (e?.payload?.["probe"] === marker) {
        clearTimeout(timer);
        socket.off("task:event", handler);
        rej(new Error("control client received a room event it did not subscribe to"));
      }
    }
    socket.on("task:event", handler);
  });
}

async function main(): Promise<void> {
  ensureEnvLoaded();
  const env = getEnv();
  const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

  log(`starting replica API on :${REPLICA_PORT}...`);
  const replica = spawn(process.execPath, [TSX_CLI, "backend/apps/api/src/server.ts"], {
    cwd: resolve(process.cwd()),
    env: { ...process.env, PORT: String(REPLICA_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const replicaLog: string[] = [];
  replica.stdout?.on("data", (d: Buffer) => replicaLog.push(d.toString("utf8")));
  replica.stderr?.on("data", (d: Buffer) => replicaLog.push(d.toString("utf8")));
  let replicaExited = false;
  replica.on("error", (err) => {
    replicaLog.push(`SPAWN ERROR: ${err.message}\n`);
  });
  replica.on("exit", (code, signal) => {
    replicaExited = true;
    replicaLog.push(`REPLICA EXIT: code=${code} signal=${signal}\n`);
  });

  const redis = new Redis(env.REDIS_URL);
  const sockets: Socket[] = [];

  try {
    await waitForHealth(PRIMARY, 10_000);
    // tsx cold-compile of the API can exceed 60s on a loaded machine
    await waitForHealth(REPLICA_BASE, 180_000);
    log("both replicas healthy");

    const email = `replica-${Date.now()}@example.com`;
    const signup = await call("POST", "/v1/auth/signup", {
      json: { email, password: "Replicatest123", displayName: "Replica" },
    });
    const token = (signup.body["data"] as { accessToken?: string } | undefined)?.accessToken;
    if (!token) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);

    const ws = await call("POST", "/v1/workspaces", { token, json: { name: "Replica WS" } });
    const workspaceId = (ws.body["data"] as { id: string }).id;
    const proj = await call("POST", `/v1/workspaces/${workspaceId}/projects`, {
      token,
      json: { name: "r", connectionType: "CLOUD", rootReference: "replica" },
    });
    const projectId = (proj.body["data"] as { id: string }).id;
    const task = await call("POST", "/v1/tasks", {
      token,
      json: { workspaceId, projectId, goal: "replica fan-out probe", selectedModelMode: "ROUTED" },
    });
    const taskId = (task.body["data"] as { id?: string } | undefined)?.id;
    if (!taskId) throw new Error(`task creation failed: ${task.status} ${JSON.stringify(task.body)}`);
    log(`task ${taskId} created`);

    const primaryClient = connect(PRIMARY, token);
    const replicaClient = connect(REPLICA_BASE, token);
    const controlClient = connect(REPLICA_BASE, token);
    sockets.push(primaryClient, replicaClient, controlClient);

    await Promise.all(
      [primaryClient, replicaClient, controlClient].map(
        (s) =>
          new Promise<void>((res, rej) => {
            s.once("connect", () => res());
            s.once("connect_error", (err) => rej(new Error(`socket connect failed: ${err.message}`)));
          }),
      ),
    );
    log("3 sockets connected (primary, replica, control)");

    primaryClient.emit("task:subscribe", { taskId });
    replicaClient.emit("task:subscribe", { taskId });
    // controlClient intentionally does NOT subscribe
    await new Promise((r) => setTimeout(r, 1500));

    const marker = `probe-${Date.now()}`;
    const received = {
      primary: waitForEvent(primaryClient, taskId, marker),
      replica: waitForEvent(replicaClient, taskId, marker),
    };
    const controlRefusal = refuteEvent(controlClient, marker);

    const published = await redis.publish(
      TASK_EVENTS_CHANNEL,
      JSON.stringify({
        taskId,
        event: { eventType: "TOOL_STARTED", runId: null, payload: { probe: marker } },
      }),
    );
    log(`event published to Redis (received by ${published} subscriber connection(s))`);
    if (published < 2) {
      throw new Error(`expected >=2 Redis subscriber connections (one per replica), got ${published}`);
    }

    await Promise.all([received.primary, received.replica]);
    log("both replicas delivered task:event to their local room");
    await controlRefusal;
    log("control client correctly received nothing");

    console.log("\nREPLICA RESULT: ✅ cross-replica Socket.IO fan-out verified");
  } catch (err) {
    if (replicaExited) log("replica process exited before becoming healthy");
    if (replicaLog.length) {
      console.error("--- replica log tail ---");
      console.error(replicaLog.join("").split(/\r?\n/).slice(-30).join("\n"));
    } else {
      log("replica produced no output yet");
    }
    throw err;
  } finally {
    for (const s of sockets) s.close();
    redis.disconnect();
    replica.kill();
  }
}

main().catch((e) => {
  console.error("REPLICA FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
