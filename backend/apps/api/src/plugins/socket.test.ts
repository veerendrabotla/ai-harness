import { describe, it, expect, afterEach } from "vitest";
import { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, Socket as ServerSocket } from "socket.io";
import { io as ClientIO, Socket as ClientSocket } from "socket.io-client";
import { createServer } from "node:http";

/**
 * Socket.IO server-side behavior contracts.
 * Real integration tests with actual Socket.IO server and client.
 */

function createTestServer(): { httpServer: HttpServer; io: SocketIOServer; port: number } {
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, { cors: { origin: "*" } });
  return { httpServer, io, port: 0 };
}

function waitForEvent(client: ClientSocket, event: string, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    client.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args.length === 1 ? args[0] : args);
    });
  });
}

describe("Socket.IO Real Integration", () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let client: ClientSocket;
  let port: number;

  afterEach(() => {
    client?.disconnect();
    io?.close();
    httpServer?.close();
  });

  it("server starts and accepts connections", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    client = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => client.on("connect", resolve));

    expect(client.connected).toBe(true);
  });

  it("server emits connection event with socket id", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    let connectedSocketId: string | undefined;
    io.on("connection", (socket: ServerSocket) => {
      connectedSocketId = socket.id;
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    client = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => client.on("connect", resolve));

    expect(connectedSocketId).toBeDefined();
    expect(connectedSocketId).toBe(client.id);
  });

  it("server can join and leave rooms", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    let serverSocket: ServerSocket;
    io.on("connection", (socket: ServerSocket) => {
      serverSocket = socket;
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    client = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => client.on("connect", resolve));

    // Join room
    serverSocket!.join("task:test-room");
    expect(serverSocket!.rooms.has("task:test-room")).toBe(true);

    // Leave room
    serverSocket!.leave("task:test-room");
    expect(serverSocket!.rooms.has("task:test-room")).toBe(false);
  });

  it("server can emit events to specific rooms", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    io.on("connection", (socket: ServerSocket) => {
      socket.join("task:room-1");
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    client = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => client.on("connect", resolve));

    // Wait for room join
    await new Promise((r) => setTimeout(r, 100));

    // Emit to room
    io.to("task:room-1").emit("task:event", { type: "TEST_EVENT", data: "hello" });

    const event = await waitForEvent(client, "task:event") as { type: string; data: string };
    expect(event.type).toBe("TEST_EVENT");
    expect(event.data).toBe("hello");
  });

  it("client receives only its own events, not other rooms", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    io.on("connection", (socket: ServerSocket) => {
      socket.join("task:my-room");
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    client = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => client.on("connect", resolve));
    await new Promise((r) => setTimeout(r, 100));

    // Emit to a different room
    io.to("task:other-room").emit("task:event", { type: "OTHER" });

    // Should not receive the event
    let received = false;
    client.on("task:event", () => { received = true; });
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toBe(false);
  });

  it("server handles multiple concurrent clients", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    const connectionCount = { count: 0 };
    io.on("connection", () => { connectionCount.count++; });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    const clients: ClientSocket[] = [];
    for (let i = 0; i < 3; i++) {
      const c = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
      await new Promise<void>((resolve) => c.on("connect", resolve));
      clients.push(c);
    }

    expect(connectionCount.count).toBe(3);

    for (const c of clients) c.disconnect();
  });

  it("server handles client disconnect gracefully", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    let disconnectCount = 0;
    io.on("connection", (socket: ServerSocket) => {
      socket.on("disconnect", () => { disconnectCount++; });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    client = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => client.on("connect", resolve));

    client.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(disconnectCount).toBe(1);
  });

  it("custom events can carry complex payloads", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    io.on("connection", (socket: ServerSocket) => {
      socket.join("task:complex");
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    client = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await new Promise<void>((resolve) => client.on("connect", resolve));
    await new Promise((r) => setTimeout(r, 100));

    const payload = {
      taskId: "task-123",
      runId: "run-456",
      eventType: "TOOL_COMPLETED",
      payload: { toolName: "filesystem.write", result: { written: "src/app.ts" } },
      timestamp: new Date().toISOString(),
    };
    io.to("task:complex").emit("task:event", payload);

    const event = await waitForEvent(client, "task:event") as { taskId: string; eventType: string; payload: { toolName: string } };
    expect(event.taskId).toBe("task-123");
    expect(event.eventType).toBe("TOOL_COMPLETED");
    expect(event.payload.toolName).toBe("filesystem.write");
  });

  it("broadcast reaches all clients in the same room", async () => {
    const server = createTestServer();
    httpServer = server.httpServer;
    io = server.io;

    io.on("connection", (socket: ServerSocket) => {
      socket.join("task:broadcast-test");
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as unknown as { port: number }).port;

    const c1 = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    const c2 = ClientIO(`http://localhost:${port}`, { transports: ["websocket"] });
    await Promise.all([
      new Promise<void>((resolve) => c1.on("connect", resolve)),
      new Promise<void>((resolve) => c2.on("connect", resolve)),
    ]);
    await new Promise((r) => setTimeout(r, 100));

    let received1 = false;
    let received2 = false;
    c1.on("task:event", () => { received1 = true; });
    c2.on("task:event", () => { received2 = true; });

    io.to("task:broadcast-test").emit("task:event", { type: "BROADCAST" });
    await new Promise((r) => setTimeout(r, 200));

    expect(received1).toBe(true);
    expect(received2).toBe(true);

    c1.disconnect();
    c2.disconnect();
  });
});
