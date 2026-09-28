"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { Plus, Layers, Clock, CheckCircle2, XCircle, Search, Download, Copy, GitFork, Share2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { TaskDtoLike, WorkspaceDtoLike } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { StateBadge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { TaskExportImport } from "@/components/task-export-import";

const ACTIVE_STATES = new Set([
  "QUEUED", "INITIALIZING", "UNDERSTANDING", "GATHERING_CONTEXT",
  "PLANNING", "EXECUTING", "WAITING_FOR_APPROVAL",
  "WAITING_FOR_TOOL_APPROVAL", "OBSERVING", "REPLANNING", "VERIFYING", "REVIEWING",
]);

function SessionRow({ task }: { task: TaskDtoLike }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const isActive = ACTIVE_STATES.has(task.state);

  const handleExport = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await apiFetch<{ package: unknown }>(`/v1/tasks/${task.id}/export`, {
        method: "POST",
        json: { includeHistory: true, includePlans: true, includeToolCalls: true },
      });
      const blob = new Blob([JSON.stringify(result.package, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session-${task.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Session exported", { variant: "success" });
    } catch {
      toast("Failed to export session", { variant: "error" });
    }
  }, [task.id, toast]);

  const handleClone = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await apiFetch<{ id: string }>(`/v1/tasks/${task.id}/clone`, { method: "POST", json: {} });
      toast("Session cloned", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["sessions-list"] });
      router.push(`/agent?task=${result.id}`);
    } catch {
      toast("Failed to clone session", { variant: "error" });
    }
  }, [task.id, qc, toast, router]);

  const handleFork = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await apiFetch<{ id: string }>(`/v1/tasks/${task.id}/fork`, {
        method: "POST",
        json: { goal: task.goal },
      });
      toast("Session forked", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["sessions-list"] });
      router.push(`/agent?task=${result.id}`);
    } catch {
      toast("Failed to fork session", { variant: "error" });
    }
  }, [task.id, task.goal, qc, toast, router]);

  const handleShare = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await apiFetch<{ token: string; url: string }>(`/v1/tasks/${task.id}/share`, {
        method: "POST",
        json: { permission: "view_only" },
      });
      await navigator.clipboard.writeText(`${window.location.origin}${result.url}`);
      toast("Share link copied to clipboard", { variant: "success" });
    } catch {
      toast("Failed to generate share link", { variant: "error" });
    }
  }, [task.id, toast]);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-2 group">
      <Link href={`/agent?task=${task.id}`} className="flex items-center gap-3 flex-1 min-w-0">
        <div className={cn(
          "h-2 w-2 rounded-full shrink-0",
          isActive ? "bg-brand animate-pulse" : task.state === "COMPLETED" ? "bg-success" : task.state === "FAILED" ? "bg-danger" : "bg-text-muted",
        )} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-text-primary group-hover:text-brand transition-colors">
            {task.goal}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
            <Clock className="h-3 w-3" />
            <span>{formatRelative(task.createdAt)}</span>
            {task.completedAt && (
              <>
                <span>·</span>
                <span>took {Math.round((new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 60_000)}m</span>
              </>
            )}
          </div>
        </div>
        <StateBadge state={task.state} />
      </Link>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={handleExport} className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors" title="Export session">
          <Download className="h-3 w-3" />
        </button>
        <button type="button" onClick={handleClone} className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors" title="Clone session">
          <Copy className="h-3 w-3" />
        </button>
        <button type="button" onClick={handleFork} className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors" title="Fork session">
          <GitFork className="h-3 w-3" />
        </button>
        <button type="button" onClick={handleShare} className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors" title="Share session">
          <Share2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export default function SessionsPage() {
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<WorkspaceDtoLike[]>("/v1/workspaces"),
  });

  const activeWs = workspaces.data?.[0]?.id;

  const tasks = useQuery({
    queryKey: ["sessions-list", activeWs],
    enabled: Boolean(activeWs),
    queryFn: () => apiFetch<TaskDtoLike[]>(`/v1/tasks?workspaceId=${activeWs}&limit=50`),
    refetchInterval: 10000,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TaskDtoLike[] | null>(null);

  const searchMutation = useMutation({
    mutationFn: (q: string) => apiFetch<{ id: string; title: string; subtitle: string }[]>(`/v1/search?q=${encodeURIComponent(q)}&type=task&workspaceId=${activeWs}`),
    onSuccess: (data) => setSearchResults(data.map((r) => ({ id: r.id, goal: r.title, state: r.subtitle?.split(" · ")[0] ?? "UNKNOWN", workspaceId: "", projectId: "", completedAt: null, archivedAt: null, selectedModelMode: "ROUTED", parentTaskId: null, constraints: null } as TaskDtoLike))),
  });

  const handleSearch = () => {
    if (searchQuery.trim().length > 0) {
      searchMutation.mutate(searchQuery.trim());
    } else {
      setSearchResults(null);
    }
  };

  const allTasks = searchResults ?? (tasks.data ?? []);
  const activeSessions = allTasks.filter((t) => ACTIVE_STATES.has(t.state));
  const completedSessions = allTasks.filter((t) => t.state === "COMPLETED");
  const failedSessions = allTasks.filter((t) => t.state === "FAILED" || t.state === "CANCELLED");

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-h1">Sessions</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Your agent conversations and tasks
            </p>
          </div>
          <Link href="/agent">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New session
            </Button>
          </Link>
        </div>

        {/* Search */}
        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              placeholder="Search sessions by goal..."
              className="h-10 w-full rounded-lg border border-border bg-surface-1 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus-visible:outline-none"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={handleSearch} loading={searchMutation.isPending}>
            Search
          </Button>
          {searchResults !== null && (
            <Button size="sm" variant="ghost" onClick={() => { setSearchResults(null); setSearchQuery(""); }}>
              Clear
            </Button>
          )}
        </div>

        {/* Stats bar */}
        {(workspaces.isError || tasks.isError) && (
          <ErrorState
            error="Failed to load sessions"
            onRetry={() => {
              workspaces.refetch();
              tasks.refetch();
            }}
          />
        )}

        {tasks.data && (
          <div className="mt-5 flex items-center gap-4 text-[12px]">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Layers className="h-3.5 w-3.5 text-text-muted" />
              <span className="font-medium">{allTasks.length}</span> total
            </div>
            {activeSessions.length > 0 && (
              <div className="flex items-center gap-1.5 text-brand">
                <div className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
                <span className="font-medium">{activeSessions.length}</span> active
              </div>
            )}
            {completedSessions.length > 0 && (
              <div className="flex items-center gap-1.5 text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="font-medium">{completedSessions.length}</span> completed
              </div>
            )}
            {failedSessions.length > 0 && (
              <div className="flex items-center gap-1.5 text-danger">
                <XCircle className="h-3.5 w-3.5" />
                <span className="font-medium">{failedSessions.length}</span> failed
              </div>
            )}
          </div>
        )}

        {/* Session list */}
        <div className="mt-5 space-y-2">
          {tasks.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : allTasks.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface-1/50 px-6 py-16 text-center">
              <Layers className="h-8 w-8 text-text-muted mb-3" />
              <h3 className="text-[14px] font-semibold text-text-primary">No sessions yet</h3>
              <p className="mt-1 text-[12px] text-text-muted max-w-sm">
                Start your first agent session to see it here. Sessions track the full lifecycle of your coding tasks.
              </p>
              <Link href="/agent" className="mt-4">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Start a session
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Active first */}
              {activeSessions.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Active</p>
                  <div className="space-y-1.5">
                    {activeSessions.map((t) => <SessionRow key={t.id} task={t} />)}
                  </div>
                </div>
              )}

              {/* Recent completed */}
              {completedSessions.length > 0 && (
                <div className={cn(activeSessions.length > 0 && "mt-6")}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Completed</p>
                  <div className="space-y-1.5">
                    {completedSessions.slice(0, 10).map((t) => <SessionRow key={t.id} task={t} />)}
                  </div>
                </div>
              )}

              {/* Failed */}
              {failedSessions.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Failed / Cancelled</p>
                  <div className="space-y-1.5">
                    {failedSessions.slice(0, 10).map((t) => <SessionRow key={t.id} task={t} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Workspace-level export/import */}
        {activeWs && (
          <div className="mt-8 border-t border-border pt-6">
            <TaskExportImport workspaceId={activeWs} mode="workspace" />
          </div>
        )}
      </div>
    </AppShell>
  );
}
