"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FileText,
  FolderGit2,
  Layers,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  Terminal,
  Zap,
  HardDrive,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { TaskDtoLike, WorkspaceDtoLike } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: typeof Zap;
  action: () => void;
  category: string;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setSelectedIndex(0);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Fetch data for dynamic commands
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    enabled: open,
    queryFn: () => apiFetch<WorkspaceDtoLike[]>("/v1/workspaces"),
  });

  const sessions = useQuery({
    queryKey: ["cmd-sessions"],
    enabled: open && Boolean(workspaces.data?.[0]?.id),
    queryFn: () => apiFetch<TaskDtoLike[]>(`/v1/tasks?workspaceId=${workspaces.data?.[0]?.id}&limit=20`),
  });

  // Build commands
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      // Navigation
      { id: "new-session", label: "New Session", description: "Start a new agent session", icon: Plus, action: () => { router.push("/agent"); setOpen(false); }, category: "Navigation" },
      { id: "sessions", label: "Sessions", description: "View all sessions", icon: Layers, action: () => { router.push("/sessions"); setOpen(false); }, category: "Navigation" },
      { id: "projects", label: "Projects", description: "Manage projects", icon: FolderGit2, action: () => { router.push("/projects"); setOpen(false); }, category: "Navigation" },

      // Settings
      { id: "settings", label: "Settings", description: "Open settings", icon: Settings, action: () => { router.push("/settings"); setOpen(false); }, category: "Settings" },
      { id: "providers", label: "Model Providers", description: "Configure AI providers", icon: Zap, action: () => { router.push("/settings/providers"); setOpen(false); }, category: "Settings" },
      { id: "routing", label: "Stage Routing", description: "Configure model routing", icon: ArrowRight, action: () => { router.push("/settings/routing"); setOpen(false); }, category: "Settings" },
      { id: "mcp", label: "MCP Servers", description: "Manage MCP integrations", icon: Server, action: () => { router.push("/settings/mcp"); setOpen(false); }, category: "Settings" },
      { id: "bridges", label: "Device Bridges", description: "Manage local bridges", icon: Terminal, action: () => { router.push("/settings/bridges"); setOpen(false); }, category: "Settings" },
      { id: "members", label: "Team Members", description: "Manage workspace members", icon: Shield, action: () => { router.push("/settings/members"); setOpen(false); }, category: "Settings" },
      { id: "security", label: "Security", description: "Sessions and account security", icon: Shield, action: () => { router.push("/settings/security"); setOpen(false); }, category: "Settings" },
      { id: "sso", label: "SSO / SAML", description: "Single sign-on configuration", icon: Shield, action: () => { router.push("/settings/sso"); setOpen(false); }, category: "Settings" },
      { id: "rate-limits", label: "Rate Limits", description: "Configure API rate limits", icon: Zap, action: () => { router.push("/settings/rate-limits"); setOpen(false); }, category: "Settings" },
      { id: "webcontainer", label: "WebContainer", description: "Configure browser-based code execution", icon: HardDrive, action: () => { router.push("/settings/webcontainer"); setOpen(false); }, category: "Settings" },

      // Workspace
      { id: "new-workspace", label: "New Workspace", description: "Create a new workspace", icon: Plus, action: () => { router.push("/workspaces/new"); setOpen(false); }, category: "Workspace" },
    ];

    // Dynamic: recent sessions
    (sessions.data ?? []).slice(0, 8).forEach((task) => {
      cmds.push({
        id: `task-${task.id}`,
        label: task.goal.length > 60 ? task.goal.slice(0, 60) + "…" : task.goal,
        description: `${task.state.replace(/_/g, " ").toLowerCase()} · ${new Date(task.createdAt).toLocaleDateString()}`,
        icon: FileText,
        action: () => { router.push(`/agent?task=${task.id}`); setOpen(false); },
        category: "Recent Sessions",
      });
    });

    return cmds;
  }, [router, sessions.data]);

  // Filter commands
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    filtered.forEach((c) => {
      if (!groups[c.category]) groups[c.category] = [];
      groups[c.category].push(c);
    });
    return groups;
  }, [filtered]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        filtered[selectedIndex].action();
      }
    },
    [filtered, selectedIndex],
  );

  // Reset selection on query change
  useEffect(() => { setSelectedIndex(0); }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector(`[aria-selected="true"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg rounded-xl border border-border-strong bg-surface-1 shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, sessions, settings…"
            className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
            aria-label="Search commands"
            aria-controls="command-palette-list"
            aria-activedescendant={filtered[selectedIndex] ? `command-option-${filtered[selectedIndex].id}` : undefined}
          />
          <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[11px] font-mono text-text-muted">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} id="command-palette-list" role="listbox" className="max-h-[300px] overflow-y-auto p-2 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-text-muted">No matching commands</p>
          ) : (
            Object.entries(grouped).map(([category, cmds]) => (
              <div key={category}>
                <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{category}</p>
                {cmds.map((cmd) => {
                  flatIndex++;
                  const idx = flatIndex;
                  return (
                    <button
                      key={cmd.id}
                      id={`command-option-${cmd.id}`}
                      type="button"
                      role="option"
                      aria-selected={idx === selectedIndex}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors",
                        idx === selectedIndex ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2",
                      )}
                    >
                      <cmd.icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{cmd.label}</p>
                        {cmd.description && <p className="truncate text-[11px] text-text-muted">{cmd.description}</p>}
                      </div>
                      <ArrowRight className="h-3 w-3 shrink-0 text-text-muted opacity-0 group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-text-muted">
          <span><kbd className="rounded border border-border bg-surface-3 px-1 py-px font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border border-border bg-surface-3 px-1 py-px font-mono">↵</kbd> select</span>
          <span><kbd className="rounded border border-border bg-surface-3 px-1 py-px font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
