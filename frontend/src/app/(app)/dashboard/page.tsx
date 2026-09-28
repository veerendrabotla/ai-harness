"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Coins,
  AlertCircle,
  Play,
  Plus,
  Layers,
  Zap,
  Square,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { formatRelative as timeAgo, formatNumber } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";

interface TaskSummary {
  id: string;
  workspaceId: string;
  goal: string;
  state: string;
  agentMode: string;
  createdAt: string;
  updatedAt: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
}

interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  totalCalls: number;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  status: string;
  memberCount: number;
}

const STATE_ICONS: Record<string, React.ReactNode> = {
  QUEUED: <Clock className="h-4 w-4 text-text-muted" />,
  PLANNING: <Layers className="h-4 w-4 text-info" />,
  EXECUTING: <Play className="h-4 w-4 text-brand animate-pulse" />,
  COMPLETED: <CheckCircle className="h-4 w-4 text-success" />,
  FAILED: <AlertCircle className="h-4 w-4 text-danger" />,
  CANCELLED: <Square className="h-4 w-4 text-text-muted" />,
};

const STATE_COLORS: Record<string, string> = {
  QUEUED: "bg-state-queued/15 text-state-queued",
  PLANNING: "bg-info/15 text-info",
  EXECUTING: "bg-brand/15 text-brand",
  COMPLETED: "bg-success/15 text-success",
  FAILED: "bg-danger/15 text-danger",
  CANCELLED: "bg-state-cancelled/15 text-state-cancelled",
};

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  const workspacesQuery = useQuery({
    queryKey: ["dashboard-workspaces"],
    queryFn: () => apiFetch<WorkspaceSummary[]>("/v1/workspaces"),
  });

  const wsId = workspacesQuery.data?.[0]?.id ?? "";

  const tasksQuery = useQuery({
    queryKey: ["dashboard-tasks", wsId],
    queryFn: () => apiFetch<TaskSummary[]>(`/v1/tasks?limit=10&workspaceId=${wsId}`),
    refetchInterval: 10000,
    enabled: Boolean(wsId),
  });

  const usageQuery = useQuery({
    queryKey: ["dashboard-usage"],
    queryFn: () => {
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return apiFetch<UsageSummary>(`/v1/usage?startDate=${startDate}&endDate=${endDate}`);
    },
  });

  const tasks = tasksQuery.data ?? [];
  const usage = usageQuery.data;
  const workspaces = workspacesQuery.data ?? [];

  const activeTasks = tasks.filter((t) => !["COMPLETED", "FAILED", "CANCELLED"].includes(t.state));
  const recentTasks = tasks.slice(0, 5);

  const hasError = tasksQuery.isError || usageQuery.isError || workspacesQuery.isError;

  return (
    <AppShell>
      <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-h1">
          {greeting}, {user?.displayName?.split(" ")[0] ?? "there"}
        </h1>
        <p className="text-text-muted mt-1">Here&apos;s what&apos;s happening with your projects</p>
      </div>

      {hasError && (
        <ErrorState
          error="Failed to load dashboard data"
          onRetry={() => {
            tasksQuery.refetch();
            usageQuery.refetch();
            workspacesQuery.refetch();
          }}
        />
      )}

      {/* Quick Actions */}
      <div className="flex gap-3 mb-8">
        <Button onClick={() => router.push("/agent")}>
          <Plus className="h-4 w-4" /> New Project
        </Button>
        <Button variant="outline" onClick={() => router.push("/agent")}>
          <Layers className="h-4 w-4" /> Agent Mode
        </Button>
        <Button variant="outline" onClick={() => router.push("/sessions")}>
          <Clock className="h-4 w-4" /> Recent Sessions
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <Layers className="h-4 w-4" /> Active Tasks
          </div>
          <div className="text-3xl font-bold">
            {tasksQuery.isLoading ? <Skeleton className="h-8 w-16" /> : activeTasks.length}
          </div>
          <p className="text-xs text-text-muted mt-1">Currently running</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <CheckCircle className="h-4 w-4" /> Completed
          </div>
          <div className="text-3xl font-bold">
            {tasksQuery.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              tasks.filter((t) => t.state === "COMPLETED").length
            )}
          </div>
          <p className="text-xs text-text-muted mt-1">This month</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <Zap className="h-4 w-4" /> Tokens Used
          </div>
          <div className="text-3xl font-bold">
            {usageQuery.isLoading ? <Skeleton className="h-8 w-16" /> : formatNumber(usage?.totalTokens ?? 0)}
          </div>
          <p className="text-xs text-text-muted mt-1">Last 30 days</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <Coins className="h-4 w-4" /> Cost
          </div>
          <div className="text-3xl font-bold">
            {usageQuery.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              `$${(usage?.estimatedCost ?? 0).toFixed(2)}`
            )}
          </div>
          <p className="text-xs text-text-muted mt-1">Last 30 days</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Tasks */}
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <CardTitle>Recent Tasks</CardTitle>
              <Link
                href="/sessions"
                className="text-sm text-brand hover:text-brand-hover flex items-center gap-1"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {tasksQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[72px]" />
                ))}
              </div>
            ) : recentTasks.length === 0 ? (
              <div className="text-center py-12">
                <Layers className="h-12 w-12 text-text-muted mx-auto mb-3" />
                <p className="text-text-muted">No tasks yet</p>
                <p className="text-xs text-text-muted mt-1">Create your first project to get started</p>
                <Button className="mt-4" onClick={() => router.push("/agent")}>
                  <Plus className="h-4 w-4" /> Start Building
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {STATE_ICONS[task.state] ?? <Clock className="h-4 w-4 text-text-muted" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{task.goal}</p>
                        <p className="text-xs text-text-muted">{timeAgo(task.updatedAt)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {task.totalTokens !== undefined && task.totalTokens > 0 && (
                        <span className="text-xs text-text-muted">{formatNumber(task.totalTokens)} tokens</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATE_COLORS[task.state] ?? ""}`}>
                        {task.state}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Workspaces Sidebar */}
        <div>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <CardTitle>Workspaces</CardTitle>
              <Link
                href="/workspaces"
                className="text-sm text-brand hover:text-brand-hover flex items-center gap-1"
              >
                Manage <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {workspacesQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-[56px]" />
                ))}
              </div>
            ) : workspaces.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-text-muted text-sm">No workspaces</p>
              </div>
            ) : (
              <div className="space-y-2">
                {workspaces.slice(0, 5).map((ws) => (
                  <Link
                    key={ws.id}
                    href={`/workspaces/${ws.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-brand/15 flex items-center justify-center text-sm font-semibold text-brand">
                        {ws.name[0]?.toUpperCase() ?? "W"}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{ws.name}</p>
                        <p className="text-xs text-text-muted">{ws.memberCount} members</p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-text-muted" />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Usage Mini Chart */}
          <Card className="mt-4">
            <CardTitle>Usage This Month</CardTitle>
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Total tokens</span>
                <span className="font-medium">{formatNumber(usage?.totalTokens ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">API calls</span>
                <span className="font-medium">{usage?.totalCalls ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Estimated cost</span>
                <span className="font-medium">${(usage?.estimatedCost ?? 0).toFixed(2)}</span>
              </div>
              <Link
                href="/usage"
                className="block text-center text-sm text-brand hover:text-brand-hover mt-2"
              >
                View detailed usage →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
    </AppShell>
  );
}
