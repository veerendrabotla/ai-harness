import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { initMultiplayerGateway } from "../src/modules/multiplayer/multiplayer.gateway.js";

/**
 * Regression: the multiplayer upgrade handler must only claim
 * /multiplayer (optionally with a room suffix). Destroying other paths
 * killed engine.io's socket.io WebSocket upgrades right after the 101
 * handshake (engine.io attaches before the gateway, so its handleUpgrade
 * runs first and the gateway's destroy() then closed the live socket),
 * which silently broke every realtime feature over WebSocket transport.
 */

const engineLike = new WebSocketServer({ noServer: true });
const clients: WebSocket[] = [];
let server: Server;
let port = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForOpen(ws: WebSocket, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve(true);
      return;
    }
    const finish = (opened: boolean) => {
      ws.off("open", onOpen);
      ws.off("close", onClose);
      resolve(opened);
    };
    const onOpen = () => finish(true);
    const onClose = () => finish(false);
    ws.on("open", onOpen);
    ws.on("close", onClose);
    ws.on("error", () => {});
    setTimeout(() => finish(ws.readyState === WebSocket.OPEN), ms);
  });
}

function dial(path: string): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  clients.push(ws);
  return ws;
}

beforeAll(async () => {
  server = createServer();
  // engine.io-like listener registered FIRST — production order is
  // socketPlugin (app.ts:176) before initMultiplayerGateway (app.ts:348).
  server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (path.startsWith("/socket.io")) {
      engineLike.handleUpgrade(req, socket, head, (ws) => engineLike.emit("connection", ws, req));
      return;
    }
    // Faithful stand-in for engine.io's destroyUpgrade: unowned upgrades
    // with no bytes written are ended after a short timeout.
    setTimeout(() => {
      if (socket.writable && socket.bytesWritten <= 0) socket.end();
    }, 150);
  });
  initMultiplayerGateway(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const client of clients) {
    try {
      client.close();
    } catch {
      /* already closed */
    }
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  engineLike.close();
});

describe("multiplayer gateway upgrade routing", () => {
  it("leaves /socket.io upgrades alone (engine.io owns them)", async () => {
    const ws = dial("/socket.io/?EIO=4&transport=websocket");
    expect(await waitForOpen(ws)).toBe(true);
    await sleep(400); // past the 150ms unowned-upgrade timeout
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("accepts the exact /multiplayer path", async () => {
    const ws = dial("/multiplayer?taskId=t1");
    expect(await waitForOpen(ws)).toBe(true);
    await sleep(300);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("accepts /multiplayer with a y-websocket room suffix", async () => {
    const ws = dial("/multiplayer/task-abc123?taskId=t1");
    expect(await waitForOpen(ws)).toBe(true);
    await sleep(300);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("does not claim unknown paths (left for engine.io cleanup)", async () => {
    const ws = dial("/task-abc123?taskId=t1");
    expect(await waitForOpen(ws, 1000)).toBe(false);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
