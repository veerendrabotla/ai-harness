"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Trash2, Copy, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

interface TerminalProps {
  projectId: string | null;
}

interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  exitCode: number;
  durationMs: number;
  createdAt: string;
}

export function Terminal({ projectId }: TerminalProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<TerminalEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchHistory = useQuery({
    queryKey: ["terminal-history", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<TerminalEntry[]>(`/v1/projects/${projectId}/terminal/history`),
  });

  useEffect(() => {
    if (fetchHistory.data) setHistory(fetchHistory.data);
  }, [fetchHistory.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [history]);

  const runCommand = useCallback(async () => {
    if (!projectId || !input.trim() || running) return;
    const cmd = input.trim();
    setInput("");
    setCmdHistory((prev) => [cmd, ...prev].slice(0, 100));
    setHistoryIndex(-1);
    setRunning(true);

    try {
      const result = await apiFetch<TerminalEntry>(`/v1/projects/${projectId}/terminal/run`, {
        method: "POST",
        json: { command: cmd },
      });
      setHistory((prev) => [...prev, result]);
    } catch (err) {
      setHistory((prev) => [...prev, {
        id: crypto.randomUUID(),
        command: cmd,
        output: err instanceof Error ? err.message : "Execution failed",
        exitCode: 1,
        durationMs: 0,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }, [projectId, input, running]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void runCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, cmdHistory.length - 1);
        setHistoryIndex(newIndex);
        setInput(cmdHistory[newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(cmdHistory[newIndex]);
      } else {
        setHistoryIndex(-1);
        setInput("");
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setHistory([]);
    }
  }, [runCommand, cmdHistory, historyIndex]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const copyOutput = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    toast("Copied to clipboard", { variant: "success" });
  }, [toast]);

  return (
    <div className="flex flex-col h-full bg-[#0a0e1a]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Terminal</span>
        <div className="flex-1" />
        <button type="button" onClick={clearHistory} className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors" title="Clear" aria-label="Clear terminal history">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Output */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-3 font-mono text-[11px] leading-5">
        {!projectId ? (
          <p className="text-text-muted">Select a project to use the terminal</p>
        ) : history.length === 0 && !running ? (
          <p className="text-text-muted">Ready. Type a command and press Enter.</p>
        ) : (
          history.map((entry) => (
            <div key={entry.id} className="mb-3">
              <div className="flex items-center gap-2">
                <span className="text-success">$</span>
                <span className="text-text-primary">{entry.command}</span>
                <span className="text-text-muted text-[11px] ml-auto">{entry.durationMs}ms</span>
                <button type="button" onClick={() => copyOutput(entry.output)} className="text-text-muted hover:text-text-secondary" title="Copy output" aria-label="Copy command output">
                  <Copy className="h-2.5 w-2.5" />
                </button>
              </div>
              <pre className={cn(
                "mt-1 whitespace-pre-wrap break-all text-[11px]",
                entry.exitCode === 0 ? "text-text-secondary" : "text-danger",
              )}>
                {entry.output}
              </pre>
              {entry.exitCode !== 0 && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-danger">
                  <XCircle className="h-2.5 w-2.5" />
                  Exit code: {entry.exitCode}
                </div>
              )}
            </div>
          ))
        )}
        {running && (
          <div className="flex items-center gap-2 text-brand">
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
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={running ? "Waiting..." : "Type a command..."}
            disabled={running || !projectId}
            className="flex-1 bg-transparent text-[11px] text-text-primary font-mono outline-none placeholder:text-text-muted disabled:opacity-50"
            autoFocus
            aria-label="Terminal command input"
          />
          <button
            type="button"
            onClick={() => void runCommand()}
            disabled={running || !input.trim() || !projectId}
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
