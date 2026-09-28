"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  Loader2,
  Send,
  HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebContainer } from "@/components/webcontainer-provider";

export function WebContainerPanel({ workspaceId }: { workspaceId: string }) {
  const {
    sessionId,
    status,
    terminalOutput,
    fileSyncStatus,
    createSession,
    runCommand,
    shutdown,
  } = useWebContainer();

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [terminalOutput]);

  const handleRun = useCallback(async () => {
    if (!input.trim() || running) return;
    const cmd = input.trim();
    setInput("");
    setRunning(true);
    try {
      await runCommand(cmd);
    } catch {
      // Error logged
    } finally {
      setRunning(false);
    }
  }, [input, running, runCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleRun();
    }
  }, [handleRun]);

  const isActive = status === "RUNNING";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <HardDrive className="h-3 w-3 text-text-muted" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          WebContainer
        </span>

        {/* Status indicator */}
        {isActive && (
          <div className="flex items-center gap-1.5 text-[11px] text-success">
            <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            <span>Running</span>
          </div>
        )}
        {status === "CREATING" && (
          <div className="flex items-center gap-1.5 text-[11px] text-brand">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Starting...</span>
          </div>
        )}

        {/* File sync indicator */}
        <span className={cn(
          "ml-auto text-[11px]",
          fileSyncStatus === "synced" ? "text-success"
            : fileSyncStatus === "syncing" ? "text-brand"
              : fileSyncStatus === "error" ? "text-danger"
                : "text-text-muted",
        )}>
          {fileSyncStatus === "synced" ? "Files synced"
            : fileSyncStatus === "syncing" ? "Syncing files..."
              : fileSyncStatus === "error" ? "Sync failed"
                : "No files"}
        </span>

        <div className="flex-1" />

        {/* Actions */}
        {isActive ? (
          <>
            <button
              type="button"
              onClick={() => { void shutdown(); }}
              className="rounded p-1 text-danger hover:bg-danger/10 transition-colors"
              title="Stop"
              aria-label="Stop WebContainer"
            >
              <Square className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => { void createSession(workspaceId); }}
            className="rounded p-1 text-success hover:bg-success/10 transition-colors"
            title="Start"
            aria-label="Start WebContainer"
          >
            <Play className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Terminal output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin p-3 font-mono text-[11px] leading-5 bg-[#0a0e1a]"
      >
        {!sessionId ? (
          <p className="text-text-muted">Click Start to launch a WebContainer</p>
        ) : terminalOutput.length === 0 ? (
          <p className="text-text-muted">Ready. Type a command and press Enter.</p>
        ) : (
          terminalOutput.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-all",
                line.startsWith("$ ") ? "text-success" : line.startsWith("ERR: ") ? "text-danger" : "text-text-secondary",
              )}
            >
              {line}
            </div>
          ))
        )}
        {running && (
          <div className="flex items-center gap-2 text-brand mt-1">
            <div className="h-2 w-2 rounded-full bg-brand animate-pulse" />
            <span className="text-[11px]">Running...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-2 shrink-0">
        <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 py-1.5 focus-within:border-brand/50 transition-colors">
          <span className="text-success font-mono text-[11px]">$</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={running ? "Waiting..." : isActive ? "Type a command..." : "Start a session first"}
            disabled={running || !isActive}
            className="flex-1 bg-transparent text-[11px] text-text-primary font-mono outline-none placeholder:text-text-muted disabled:opacity-50"
            aria-label="WebContainer command input"
          />
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running || !input.trim() || !isActive}
            className={cn(
              "rounded p-1 transition-colors",
              input.trim() && !running ? "text-brand hover:bg-brand/10" : "text-text-disabled",
            )}
            aria-label="Send command"
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
