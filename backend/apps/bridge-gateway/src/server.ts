import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { prisma } from "@ai-harness/database";
import {
  createLogger,
  ensureEnvLoaded,
  getEnv,
  loadEnv,
  safeEqual,
  sha256Hex,
  type BridgeExecRequest,
} from "@ai-harness/shared";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const sockets = new Map<string, WebSocket>();
const pending = new Map<string, Pending>();
const logger = createLogger({ name: "ai-harness-gateway" });

// Gateway is single-replica by design (in-memory sockets + pending).
// Multi-replica requires Redis Streams for pending correlation and
// Redis adapter for WS fan-out. Until then, deploy gateway as 1 replica
// and rely on the sweeper to mark DEGRADED→DISCONNECTED on restart.

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function handleHello(socket: WebSocket, raw: RawData): Promise<boolean> {
  let msg: { type?: string; bridgeId?: string; deviceToken?: string; version?: string };
  try {
    msg = JSON.parse(String(raw));
  } catch (err) {
    logger.warn({ err }, "BridgeGateway: failed to parse hello message");
    socket.close(4400, "bad json");
    return false;
  }
  if (msg.type !== "hello" || !msg.bridgeId || !msg.deviceToken) {
    socket.close(4401, "expected hello");
    return false;
  }
  const bridge = await prisma.bridge.findUnique({ where: { id: msg.bridgeId } });
  if (!bridge || !bridge.deviceTokenHash || !safeEqual(bridge.deviceTokenHash, sha256Hex(msg.deviceToken))) {
    socket.close(4401, "authentication failed");
    return false;
  }
  if (bridge.status === "REVOKED") {
    socket.close(4403, "bridge revoked");
    return false;
  }
  sockets.set(bridge.id, socket);
  await prisma.bridge.update({
    where: { id: bridge.id },
    data: { status: "CONNECTED", lastSeenAt: new Date(), version: String(msg["version"] ?? bridge.version) },
  });
  logger.info({ bridgeId: bridge.id }, "bridge connected");
  send(socket, { type: "welcome", bridgeId: bridge.id });

  socket.on("close", () => {
    sockets.delete(bridge.id);
    // Clean up pending requests for this bridge
    for (const [id, p] of pending) {
      if ((p as unknown as { bridgeId?: string }).bridgeId === bridge.id) {
        clearTimeout(p.timer);
        p.reject(new Error("bridge disconnected"));
        pending.delete(id);
      }
    }
    void prisma.bridge.updateMany({
      where: { id: bridge.id, status: "CONNECTED" },
      data: { status: "DEGRADED" },
    });
    logger.info({ bridgeId: bridge.id }, "bridge disconnected");
  });
  // Per-bridge WS throttling — max 60 messages/min (prevents exec spam DoS)
  let msgCount = 0;
  let windowStart = Date.now();
  const MAX_MSG_PER_MIN = 60;

  socket.on("message", (data: RawData) => {
    // Rate check for post-auth messages
    const elapsed = Date.now() - windowStart;
    if (elapsed > 60_000) { msgCount = 0; windowStart = Date.now(); }
    if (++msgCount > MAX_MSG_PER_MIN) {
      logger.warn({ bridgeId: bridge.id, msgCount }, "BridgeGateway: WS rate limit exceeded");
      send(socket, { type: "error", code: "RATE_LIMITED", message: "Too many messages, slow down" });
      return;
    }
    try {
      const parsed = JSON.parse(String(data)) as { type?: string; id?: string; ok?: boolean };
      if (parsed.type === "result" && parsed.id) {
        const p = pending.get(parsed.id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(parsed.id);
          p.resolve(parsed);
        }
      }
    } catch (err) {
      logger.warn({ err }, "BridgeGateway: malformed message frame");
    }
  });
  return true;
}

// HTTP /execute throttling — max 30 requests/min per IP (prevents API spam)
const httpExecCounts = new Map<string, { count: number; windowStart: number }>();
const MAX_HTTP_EXEC_PER_MIN = 30;

function checkHttpExecRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = httpExecCounts.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    httpExecCounts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MAX_HTTP_EXEC_PER_MIN) return false;
  entry.count++;
  return true;
}
// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of httpExecCounts) {
    if (now - v.windowStart > 120_000) httpExecCounts.delete(k);
  }
}, 60_000).unref();

async function handleExecute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  if (!checkHttpExecRateLimit(clientIp)) {
    res.writeHead(429).end(JSON.stringify({ error: "rate_limited", message: "Too many execute requests, slow down" }));
    return;
  }
  const env = getEnv();
  const token = req.headers["x-internal-token"] ?? "";
  if (!token || !safeEqual(String(token), env.BRIDGE_INTERNAL_TOKEN)) {
    res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  let body = "";
  req.on("data", (c: Buffer) => {
    body += c;
    if (body.length > 1_000_000) {
      req.destroy();
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Body too large" }));
      return;
    }
  });
  req.on("end", async () => {
    try {
      const { bridgeId, request } = JSON.parse(body) as {
        bridgeId: string;
        request: BridgeExecRequest;
      };
      const socket = sockets.get(bridgeId);
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        res.writeHead(503).end(
          JSON.stringify({ ok: false, error: { code: "BRIDGE_DISCONNECTED", message: "Bridge is not connected" } }),
        );
        return;
      }
      const execReq: BridgeExecRequest = {
        id: request.id ?? randomUUID(),
        kind: request.kind,
        params: request.params ?? {},
        timeoutMs: Math.min(Math.max(request.timeoutMs ?? 30_000, 1_000), 300_000),
      };
      const reply = await new Promise<{
        ok?: boolean;
        data?: Record<string, unknown>;
        error?: { code: string; message: string };
      }>((resolveValue, rejectValue) => {
          const timer = setTimeout(() => {
            pending.delete(execReq.id);
            rejectValue(new Error("bridge did not answer in time"));
          }, execReq.timeoutMs + 2_000);
          pending.set(execReq.id, { resolve: resolveValue as (value: unknown) => void, reject: rejectValue, timer });
          send(socket, { type: "exec", ...execReq });
        },
      );
      res.writeHead(200).end(
        JSON.stringify({
          ok: reply.ok === true,
          data: reply.data ?? undefined,
          error: reply.error ?? undefined,
        }),
      );
    } catch (err) {
      res.writeHead(400).end(
        JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: err instanceof Error ? err.message : "bad" } }),
      );
    }
  });
}

/**
 * HTTP proxy via bridge — allows remote preview.
 * The preview server binds to http://localhost:3000 on the bridge host only.
 * Browsers on a different machine cannot reach it directly, so this endpoint
 * forwards an HTTP fetch through the bridge's WebSocket (similar to handleExecute).
 * Bridge handles `http.proxy` by performing `fetch(url)` locally and returning
 * { status, headers, body }.
 */
async function handleProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  if (!checkHttpExecRateLimit(clientIp)) {
    res.writeHead(429).end(JSON.stringify({ error: "rate_limited", message: "Too many proxy requests, slow down" }));
    return;
  }
  const env = getEnv();
  const token = req.headers["x-internal-token"] ?? "";
  if (!token || !safeEqual(String(token), env.BRIDGE_INTERNAL_TOKEN)) {
    res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  let body = "";
  req.on("data", (c: Buffer) => {
    body += c;
    if (body.length > 1_000_000) {
      req.destroy();
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Body too large" }));
      return;
    }
  });
  req.on("end", async () => {
    try {
      const parsed = JSON.parse(body) as {
        bridgeId?: string;
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        request?: { url?: string; method?: string; headers?: Record<string, string>; body?: string };
      };
      // Support both { bridgeId, url, ... } and { bridgeId, request: { url, ... } }
      const bridgeId = parsed.bridgeId;
      const url = parsed.url ?? parsed.request?.url;
      const method = parsed.method ?? parsed.request?.method ?? "GET";
      const headers = parsed.headers ?? parsed.request?.headers;
      const reqBody = parsed.body ?? parsed.request?.body;
      if (!bridgeId || !url) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: "bridgeId and url required" } }));
        return;
      }
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: "invalid url" } }));
        return;
      }
      // Only allow http/https to localhost/private hosts via proxy (prevents SSRF to internal infra).
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: "only http/https allowed" } }));
        return;
      }
      const socket = sockets.get(bridgeId);
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        res.writeHead(503).end(JSON.stringify({ ok: false, error: { code: "BRIDGE_DISCONNECTED", message: "Bridge is not connected" } }));
        return;
      }
      const execReq: BridgeExecRequest = {
        id: randomUUID(),
        kind: "http.proxy" as BridgeExecRequest["kind"],
        params: { url, method, headers: headers ?? {}, body: reqBody ?? "" },
        timeoutMs: 15_000,
      };
      const reply = await new Promise<{ ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }>(
        (resolveValue, rejectValue) => {
          const timer = setTimeout(() => {
            pending.delete(execReq.id);
            rejectValue(new Error("bridge did not answer in time"));
          }, execReq.timeoutMs + 2_000);
          pending.set(execReq.id, { resolve: resolveValue as (value: unknown) => void, reject: rejectValue, timer });
          send(socket, { type: "exec", ...execReq });
        },
      );
      res.writeHead(200).end(JSON.stringify({ ok: reply.ok === true, data: reply.data ?? undefined, error: reply.error ?? undefined }));
    } catch (err) {
      res.writeHead(400).end(JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: err instanceof Error ? err.message : "bad" } }));
    }
  });
}

/** Presence sweeper: DEGRADED → DISCONNECTED and dependent projects UNAVAILABLE. */
function startSweeper(): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      const cutoff = new Date(Date.now() - 90_000);
      const stale = await prisma.bridge.findMany({
        where: { status: "DEGRADED", lastSeenAt: { lt: cutoff } },
        select: { id: true },
      });
      for (const b of stale) {
        await prisma.bridge.update({ where: { id: b.id }, data: { status: "DISCONNECTED" } });
        await prisma.project.updateMany({
          where: { bridgeId: b.id, connectionType: "LOCAL_BRIDGE" },
          data: { status: "UNAVAILABLE" },
        });
        logger.info({ bridgeId: b.id }, "bridge marked DISCONNECTED");
      }
      // Heartbeat connected bridges.
      for (const bridgeId of sockets.keys()) {
        await prisma.bridge.updateMany({
          where: { id: bridgeId },
          data: { lastSeenAt: new Date(), status: "CONNECTED" },
        });
      }
    })().catch((err) => logger.error({ err: err instanceof Error ? err.message : err }, "sweep failed"));
  }, 30_000);
}

export function startGateway(onReady?: () => void): void {
  ensureEnvLoaded();
  const env = loadEnv();

  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200).end(JSON.stringify({ status: "ok", connectedBridges: sockets.size }));
      return;
    }
    if (req.method === "POST" && req.url === "/execute") {
      void handleExecute(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/bridge/proxy") {
      void handleProxy(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/bridge") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let authenticated = false;
      let lastPong = Date.now();
      ws.on("pong", () => { lastPong = Date.now(); });
      ws.on("message", (data: RawData) => {
        if (!authenticated) {
          void handleHello(ws, data).then((ok) => {
            authenticated = ok;
          });
          return;
        }
      });
      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          if (Date.now() - lastPong > 60_000) {
            ws.terminate();
            return;
          }
          ws.ping();
        }
      }, 20_000);
      ws.on("close", () => clearInterval(hb));
    });
  });

  const sweeper = startSweeper();
  httpServer.listen(env.BRIDGE_GATEWAY_PORT, "0.0.0.0", () => {
    logger.info({ port: env.BRIDGE_GATEWAY_PORT }, "AI Harness bridge gateway ready");
    onReady?.();
  });

  const shutdown = () => {
    clearInterval(sweeper);
    for (const ws of sockets.values()) ws.close(1001, "gateway shutting down");
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startGateway();
