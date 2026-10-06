import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import { Redis } from "ioredis";
import { createLogger, getEnv } from "@ai-harness/shared";
import { verifyAccessToken } from "../../lib/tokens.js";
import { getSharedRedis } from "../../lib/redis.js";

// Multi-replica fan-out: presence is mirrored to Redis hash `presence:{taskId}`
// (field=userId, value=JSON UserPresence, TTL 90s) for HTTP reads, and every
// broadcast is published to the `mp:broadcast` Redis channel so all replicas
// deliver awareness/cursor/selection/presence/yjs messages to their local
// clients. Own-replica messages are skipped by the subscriber (the direct
// local send already delivered them); with Redis unavailable the gateway
// degrades to in-process broadcast (single-node dev).

// Peer dependency: yjs (npm i yjs)
// The server acts as a thin relay: it forwards Yjs sync/update messages
// between clients and maintains awareness state (cursors, selections).

export interface UserPresence {
  userId: string;
  name: string;
  color: string;
  cursor?: { line: number; column: number; file?: string };
  selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number; file?: string };
  status: "editing" | "viewing" | "idle";
  joinedAt: number;
}

interface Room {
  taskId: string;
  clients: Map<WebSocket, UserPresence>;
}

const COLORS = ["#E06C75", "#61AFEF", "#C678DD", "#E5C07B", "#56B6C2", "#98C379", "#D19A66", "#BE5046"];
let colorIndex = 0;

function nextColor(): string {
  const c = COLORS[colorIndex % COLORS.length]!;
  colorIndex++;
  return c;
}

const rooms = new Map<string, Room>();
const logger = createLogger({ name: "ai-harness-multiplayer" });

// ── Cross-replica broadcast (Redis pub/sub) ──────────────────
const MP_BROADCAST_CHANNEL = "mp:broadcast";
const REPLICA_ID = randomUUID();
const wsIds = new WeakMap<WebSocket, number>();
let nextWsId = 1;
let mpPublisher: Redis | null = null;
let mpSubscriber: Redis | null = null;

interface MpBroadcastMessage {
  taskId: string;
  replicaId: string;
  excludeWsId?: number;
  msg: unknown;
}

function sendLocal(room: Room, msg: unknown, exclude?: WebSocket): void {
  const data = JSON.stringify(msg);
  for (const [ws] of room.clients) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function publishBroadcast(message: MpBroadcastMessage): void {
  if (!mpPublisher) return;
  mpPublisher.publish(MP_BROADCAST_CHANNEL, JSON.stringify(message)).catch((err) => {
    logger.warn({ err, taskId: message.taskId }, "failed to publish multiplayer broadcast");
  });
}

function broadcast(room: Room, msg: unknown, exclude?: WebSocket): void {
  sendLocal(room, msg, exclude);
  publishBroadcast({
    taskId: room.taskId,
    replicaId: REPLICA_ID,
    excludeWsId: exclude ? wsIds.get(exclude) : undefined,
    msg,
  });
}

function setupReplicaFanout(): void {
  try {
    const env = getEnv();
    mpPublisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    mpSubscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    mpPublisher.on("error", (err) => logger.warn({ err }, "multiplayer publisher error"));
    mpSubscriber.on("error", (err) => logger.warn({ err }, "multiplayer subscriber error"));
    mpSubscriber.subscribe(MP_BROADCAST_CHANNEL).catch((err) => {
      logger.warn({ err }, "multiplayer subscriber failed to subscribe");
    });
    mpSubscriber.on("message", (channel: string, raw: string) => {
      if (channel !== MP_BROADCAST_CHANNEL) return;
      try {
        const parsed = JSON.parse(raw) as MpBroadcastMessage;
        // Own messages were already delivered by the direct local send.
        if (parsed.replicaId === REPLICA_ID) return;
        const room = rooms.get(parsed.taskId);
        if (!room) return;
        // The excluded ws lives on the origin replica — deliver to everyone here.
        sendLocal(room, parsed.msg);
      } catch (err) {
        logger.warn({ err }, "failed to handle multiplayer broadcast");
      }
    });
    logger.info({ replicaId: REPLICA_ID }, "multiplayer replica fan-out enabled");
  } catch (err) {
    logger.warn({ err }, "multiplayer fan-out unavailable; falling back to in-process broadcast");
    mpPublisher = null;
    mpSubscriber = null;
  }
}

const PRESENCE_TTL_SECONDS = 90;
const presenceKey = (taskId: string) => `presence:${taskId}`;

async function persistPresenceToRedis(taskId: string, presence: UserPresence): Promise<void> {
  try {
    const redis = getSharedRedis();
    if (!redis) return;
    await redis.hset(presenceKey(taskId), presence.userId, JSON.stringify(presence));
    await redis.expire(presenceKey(taskId), PRESENCE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, taskId }, "failed to persist presence to Redis");
  }
}

async function removePresenceFromRedis(taskId: string, userId: string): Promise<void> {
  try {
    const redis = getSharedRedis();
    if (!redis) return;
    await redis.hdel(presenceKey(taskId), userId);
  } catch (err) {
    logger.warn({ err, taskId, userId }, "failed to remove presence from Redis");
  }
}

async function getPresenceFromRedis(taskId: string): Promise<UserPresence[] | null> {
  try {
    const redis = getSharedRedis();
    if (!redis) return null;
    const hash = await redis.hgetall(presenceKey(taskId));
    if (!hash || Object.keys(hash).length === 0) return null;
    const users: UserPresence[] = [];
    for (const v of Object.values(hash)) {
      try {
        users.push(JSON.parse(v as string) as UserPresence);
      } catch { /* ignore corrupt entry */ }
    }
    return users.length > 0 ? users : null;
  } catch (err) {
    logger.warn({ err, taskId }, "failed to read presence from Redis");
    return null;
  }
}

function getRoom(taskId: string): Room {
  let room = rooms.get(taskId);
  if (!room) {
    room = { taskId, clients: new Map() };
    rooms.set(taskId, room);
  }
  return room;
}

function broadcastPresence(room: Room): void {
  const users = Array.from(room.clients.values());
  broadcast(room, { type: "presence", users });
}

export function initMultiplayerGateway(server: import("node:http").Server): void {
  const wss = new WebSocketServer({ noServer: true });
  setupReplicaFanout();
  server.on("close", () => {
    mpPublisher?.disconnect();
    mpSubscriber?.disconnect();
    mpPublisher = null;
    mpSubscriber = null;
  });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    // Only claim /multiplayer (optionally with a room suffix). Other paths
    // (notably /socket.io owned by engine.io) must be left untouched — a
    // destroy() here kills legitimate socket.io WebSocket upgrades because
    // engine.io already completed its own 101 handshake by the time this
    // listener runs.
    if (url.pathname !== "/multiplayer" && !url.pathname.startsWith("/multiplayer/")) {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const taskId = url.searchParams.get("taskId");
    const token = url.searchParams.get("token");

    if (!taskId) {
      ws.close(4400, "taskId required");
      return;
    }

    // Authenticate via JWT token
    let userId = "anonymous";
    let userName = "Anonymous";
    if (token) {
      try {
        const decoded = await verifyAccessToken(token);
        userId = decoded.sub;
        userName = decoded.email ?? decoded.sub;
      } catch (err) {
        logger.warn({ err }, "Invalid JWT token in multiplayer connection");
        ws.close(4401, "Invalid authentication token");
        return;
      }
    } else {
      // Allow anonymous for dev/testing, but log warning
      logger.warn({ taskId }, "Unauthenticated multiplayer connection (anonymous mode)");
    }

    const room = getRoom(taskId);
    wsIds.set(ws, nextWsId++);
    const presence: UserPresence = {
      userId,
      name: userName,
      color: nextColor(),
      status: "viewing",
      joinedAt: Date.now(),
    };
    room.clients.set(ws, presence);
    void persistPresenceToRedis(taskId, presence);
    logger.info({ taskId, userId, userName }, "user joined multiplayer room");

    ws.send(JSON.stringify({ type: "welcome", taskId, userId, color: presence.color }));
    broadcastPresence(room);

    ws.on("message", (data: RawData) => {
      let msg: { type?: string; [key: string]: unknown };
      try {
        msg = JSON.parse(String(data));
      } catch (err) {
        logger.error({ err }, "[Multiplayer] Failed to parse message:");
        return;
      }

      const current = room.clients.get(ws);
      if (!current) return;

      switch (msg.type) {
        case "awareness": {
          const update = msg.update as Partial<UserPresence> | undefined;
          if (update) {
            if (update.cursor) current.cursor = update.cursor;
            if (update.selection) current.selection = update.selection;
            if (update.status) current.status = update.status;
          }
          void persistPresenceToRedis(taskId, current);
          broadcast(room, { type: "awareness", userId: current.userId, update: current }, ws);
          break;
        }
        case "yjs-sync":
        case "yjs-update": {
          broadcast(room, msg, ws);
          break;
        }
        case "cursor": {
          current.cursor = msg.cursor as UserPresence["cursor"];
          void persistPresenceToRedis(taskId, current);
          broadcast(room, { type: "cursor", userId: current.userId, cursor: current.cursor }, ws);
          break;
        }
        case "selection": {
          current.selection = msg.selection as UserPresence["selection"];
          void persistPresenceToRedis(taskId, current);
          broadcast(room, { type: "selection", userId: current.userId, selection: current.selection }, ws);
          break;
        }
        default:
          break;
      }
    });

    ws.on("close", () => {
      room.clients.delete(ws);
      void removePresenceFromRedis(taskId, userId);
      logger.info({ taskId, userId }, "user left multiplayer room");
      broadcastPresence(room);
      if (room.clients.size === 0) {
        rooms.delete(taskId);
      }
    });

    ws.on("error", (err) => {
      logger.error({ err, taskId, userId }, "multiplayer ws error");
    });
  });

  logger.info("multiplayer gateway initialized");
}

/** HTTP handlers for REST endpoints
 * The in-memory Map is per-process, but presence is mirrored to Redis
 * (`presence:{taskId}` hash with 90s TTL) and WS broadcasts fan out via the
 * `mp:broadcast` Redis channel, so multi-replica deploys stay consistent.
 * `getConnectedUsers` prefers Redis when available, falling back to the
 * local Map for single-node dev without Redis.
 */
export async function getConnectedUsers(taskId: string): Promise<UserPresence[]> {
  // Prefer Redis (shared across replicas) when available; fallback to in-memory Map for dev/single-node.
  const redisUsers = await getPresenceFromRedis(taskId);
  if (redisUsers) return redisUsers;
  const room = rooms.get(taskId);
  if (!room) return [];
  return Array.from(room.clients.values());
}

// Sync variant kept for callers that cannot await (e.g., in-process broadcast path)
export function getConnectedUsersSync(taskId: string): UserPresence[] {
  const room = rooms.get(taskId);
  if (!room) return [];
  return Array.from(room.clients.values());
}

export function broadcastCursor(taskId: string, userId: string, cursor: UserPresence["cursor"]): void {
  const room = rooms.get(taskId);
  // Persist to Redis for cross-replica HTTP reads (fire-and-forget)
  void (async () => {
    try {
      const redis = getSharedRedis();
      if (redis) {
        const existing = await redis.hget(presenceKey(taskId), userId);
        if (existing) {
          const p = JSON.parse(existing) as UserPresence;
          p.cursor = cursor;
          await persistPresenceToRedis(taskId, p);
        }
      }
    } catch { /* ignore */ }
  })();
  const msg = { type: "cursor", userId, cursor };
  if (room) {
    for (const [, presence] of room.clients) {
      if (presence.userId === userId) {
        presence.cursor = cursor;
        void persistPresenceToRedis(taskId, presence);
        break;
      }
    }
    broadcast(room, msg);
  } else {
    // No local clients — still fan out to replicas that have them.
    publishBroadcast({ taskId, replicaId: REPLICA_ID, msg });
  }
}

export function broadcastSelection(taskId: string, userId: string, selection: UserPresence["selection"]): void {
  const room = rooms.get(taskId);
  void (async () => {
    try {
      const redis = getSharedRedis();
      if (redis) {
        const existing = await redis.hget(presenceKey(taskId), userId);
        if (existing) {
          const p = JSON.parse(existing) as UserPresence;
          p.selection = selection;
          await persistPresenceToRedis(taskId, p);
        }
      }
    } catch { /* ignore */ }
  })();
  const msg = { type: "selection", userId, selection };
  if (room) {
    for (const [, presence] of room.clients) {
      if (presence.userId === userId) {
        presence.selection = selection;
        void persistPresenceToRedis(taskId, presence);
        break;
      }
    }
    broadcast(room, msg);
  } else {
    // No local clients — still fan out to replicas that have them.
    publishBroadcast({ taskId, replicaId: REPLICA_ID, msg });
  }
}
