"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface WebContainerContextValue {
  sessionId: string | null;
  status: string | null;
  terminalOutput: string[];
  fileSyncStatus: "idle" | "syncing" | "synced" | "error";
  createSession: (workspaceId: string) => Promise<string>;
  syncFiles: (files: Record<string, string>) => Promise<void>;
  runCommand: (command: string) => Promise<void>;
  shutdown: () => Promise<void>;
}

const WebContainerContext = createContext<WebContainerContextValue | null>(null);

export function useWebContainer() {
  const ctx = useContext(WebContainerContext);
  if (!ctx) throw new Error("useWebContainer must be used within WebContainerProvider");
  return ctx;
}

export function WebContainerProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [fileSyncStatus, setFileSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");

  const createSession = useCallback(async (workspaceId: string) => {
    const result = await apiFetch<{ sessionId: string }>("/v1/webcontainer/create", {
      method: "POST",
      json: { workspaceId },
    });
    setSessionId(result.sessionId);
    setStatus("RUNNING");
    setTerminalOutput(["Session created"]);
    return result.sessionId;
  }, []);

  const syncFiles = useCallback(async (files: Record<string, string>) => {
    if (!sessionId) throw new Error("No active session");
    setFileSyncStatus("syncing");
    try {
      await apiFetch(`/v1/webcontainer/${sessionId}/files`, {
        method: "POST",
        json: files,
      });
      setFileSyncStatus("synced");
      setTerminalOutput((prev) => [...prev, `Synced ${Object.keys(files).length} file(s)`]);
    } catch {
      setFileSyncStatus("error");
      throw new Error("File sync failed");
    }
  }, [sessionId]);

  const runCommand = useCallback(async (command: string) => {
    if (!sessionId) throw new Error("No active session");
    setTerminalOutput((prev) => [...prev, `$ ${command}`]);
    const result = await apiFetch<{ stdout: string; stderr: string; exitCode: number }>(
      `/v1/webcontainer/${sessionId}/run`,
      { method: "POST", json: { command } },
    );
    if (result.stdout) setTerminalOutput((prev) => [...prev, result.stdout]);
    if (result.stderr) setTerminalOutput((prev) => [...prev, `ERR: ${result.stderr}`]);
  }, [sessionId]);

  const shutdown = useCallback(async () => {
    if (!sessionId) return;
    await apiFetch(`/v1/webcontainer/${sessionId}`, { method: "DELETE" });
    setSessionId(null);
    setStatus(null);
    setTerminalOutput([]);
    setFileSyncStatus("idle");
  }, [sessionId]);

  const value = useMemo<WebContainerContextValue>(() => ({
    sessionId,
    status,
    terminalOutput,
    fileSyncStatus,
    createSession,
    syncFiles,
    runCommand,
    shutdown,
  }), [sessionId, status, terminalOutput, fileSyncStatus, createSession, syncFiles, runCommand, shutdown]);

  return (
    <WebContainerContext.Provider value={value}>
      {children}
    </WebContainerContext.Provider>
  );
}
