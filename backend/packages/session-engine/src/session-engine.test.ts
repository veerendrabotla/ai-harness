import { describe, it, expect, beforeEach } from "vitest";
import { SessionEngine } from "./session-engine.js";

describe("SessionEngine", () => {
  let engine: SessionEngine;

  beforeEach(() => {
    engine = new SessionEngine();
  });

  describe("Session Creation", () => {
    it("should create a session", async () => {
      const session = await engine.createSession({
        name: "Test Session",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      expect(session.id).toBeDefined();
      expect(session.name).toBe("Test Session");
      expect(session.status).toBe("active");
    });
  });

  describe("Session Lifecycle", () => {
    it("should pause and resume session", async () => {
      const session = await engine.createSession({
        name: "Lifecycle",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await engine.pauseSession(session.id);
      expect(engine.getSession(session.id)?.status).toBe("paused");

      await engine.resumeSession(session.id);
      expect(engine.getSession(session.id)?.status).toBe("active");
    });

    it("should archive session", async () => {
      const session = await engine.createSession({
        name: "Archive",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await engine.archiveSession(session.id);
      expect(engine.getSession(session.id)?.status).toBe("archived");
    });

    it("should delete and restore session", async () => {
      const session = await engine.createSession({
        name: "Delete",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      await engine.deleteSession(session.id);
      expect(engine.getSession(session.id)?.status).toBe("deleted");

      await engine.restoreSession(session.id);
      expect(engine.getSession(session.id)?.status).toBe("active");
    });
  });

  describe("Session Forking", () => {
    it("should fork a session", async () => {
      const session = await engine.createSession({
        name: "Original",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const fork = await engine.forkSession(session.id, "Forked");
      expect(fork).not.toBeNull();
      expect(fork?.newSessionId).toBeDefined();

      const forkedSession = engine.getSession(fork?.newSessionId || "");
      expect(forkedSession?.name).toBe("Forked");
      expect(forkedSession?.forkedFrom).toBe(session.id);
    });

    it("should clone a session", async () => {
      const session = await engine.createSession({
        name: "Original",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const clone = await engine.cloneSession(session.id, "Cloned");
      expect(clone).not.toBeNull();
      expect(clone?.name).toBe("Cloned");
    });
  });

  describe("Session Messages", () => {
    it("should add messages to session", async () => {
      const session = await engine.createSession({
        name: "Messaging",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const msg = await engine.addMessage(session.id, {
        role: "user",
        content: "Hello",
      });

      expect(msg).not.toBeNull();
      expect(msg?.content).toBe("Hello");
    });

    it("should add tool calls to session", async () => {
      const session = await engine.createSession({
        name: "Tool Calls",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const call = await engine.addToolCall(session.id, {
        name: "read_file",
        input: { path: "test.ts" },
        output: "content",
        success: true,
        duration: 100,
      });

      expect(call).not.toBeNull();
      expect(call?.name).toBe("read_file");
    });
  });

  describe("Session Plans", () => {
    it("should add and approve plans", async () => {
      const session = await engine.createSession({
        name: "Plans",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const plan = await engine.addPlan(session.id, {
        content: "Do something",
        approved: false,
      });

      expect(plan).not.toBeNull();

      const approved = await engine.approvePlan(session.id, plan!.id, "user-1");
      expect(approved).toBe(true);
    });
  });

  describe("Session Search", () => {
    it("should search sessions by project", async () => {
      await engine.createSession({ name: "S1", projectId: "proj-1", workspaceId: "ws-1" });
      await engine.createSession({ name: "S2", projectId: "proj-2", workspaceId: "ws-1" });

      const results = await engine.searchSessions({ projectId: "proj-1" });
      expect(results.length).toBe(1);
    });

    it("should search sessions by status", async () => {
      const s1 = await engine.createSession({ name: "S1", projectId: "proj-1", workspaceId: "ws-1" });
      await engine.pauseSession(s1.id);
      await engine.createSession({ name: "S2", projectId: "proj-1", workspaceId: "ws-1" });

      const results = await engine.searchSessions({ status: "paused" });
      expect(results.length).toBe(1);
    });
  });

  describe("Session Export/Import", () => {
    it("should export and import session", async () => {
      const session = await engine.createSession({
        name: "Export",
        projectId: "proj-1",
        workspaceId: "ws-1",
      });

      const exported = await engine.exportSession(session.id);
      expect(exported).not.toBeNull();

      const imported = await engine.importSession(exported!);
      expect(imported.name).toBe("Export");
      expect(imported.id).not.toBe(session.id);
    });
  });
});
