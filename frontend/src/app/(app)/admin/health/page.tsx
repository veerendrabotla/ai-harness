"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Database,
  Server,
  Clock,
  RefreshCw,
  Check,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface HealthStatus {
  status: string;
  checks: {
    database: string;
    redis?: string;
    worker?: string;
  };
  uptime?: number;
  version?: string;
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function AdminHealthPage() {
  const health = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => apiFetch<HealthStatus>("/v1/admin/health"),
    refetchInterval: 30000,
  });

  const statsQuery = useQuery({
    queryKey: ["admin", "health-stats"],
    queryFn: async () => {
      const data = await apiFetch<{ queue?: QueueStats; waiting?: number; active?: number; completed?: number; failed?: number }>("/v1/admin/stats");
      return (data.queue ?? { waiting: data.waiting ?? 0, active: data.active ?? 0, completed: data.completed ?? 0, failed: data.failed ?? 0 }) as QueueStats;
    },
    refetchInterval: 10000,
  });

  const isHealthy = health.data?.status === "ok";

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-brand" />
            <div>
              <h1 className="text-h1">
                System Health
              </h1>
              <p className="mt-1 text-[12px] text-text-muted">
                Real-time platform health monitoring
              </p>
            </div>
          </div>
          <Button
            onClick={() => {
              health.refetch();
              statsQuery.refetch();
            }}
            variant="secondary"
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[11px] text-text-muted">Overall Status</CardTitle>
              {isHealthy ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <X className="h-4 w-4 text-danger" />
              )}
            </div>
            <p className={`mt-1 text-[16px] font-bold ${isHealthy ? "text-success" : "text-danger"}`}>
              {isHealthy ? "Healthy" : "Degraded"}
            </p>
          </Card>

          <Card className="p-4">
            <CardTitle className="text-[11px] text-text-muted">Uptime</CardTitle>
            <p className="mt-1 text-[16px] font-bold text-text-primary">
              {health.data?.uptime ? formatUptime(health.data.uptime) : "-"}
            </p>
          </Card>

          <Card className="p-4">
            <CardTitle className="text-[11px] text-text-muted">Queue Depth</CardTitle>
            <p className="mt-1 text-[16px] font-bold text-text-primary">
              {statsQuery.data ? statsQuery.data.waiting + statsQuery.data.active : "-"}
            </p>
          </Card>

          <Card className="p-4">
            <CardTitle className="text-[11px] text-text-muted">Failed Jobs</CardTitle>
            <p className={`mt-1 text-[16px] font-bold ${(statsQuery.data?.failed ?? 0) > 0 ? "text-danger" : "text-text-primary"}`}>
              {statsQuery.data?.failed ?? 0}
            </p>
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5">
            <CardTitle className="text-[14px] text-text-primary flex items-center gap-2">
              <Database className="h-4 w-4" />
              Service Health
            </CardTitle>
            <div className="mt-4 space-y-3">
              {health.isLoading && <Skeleton className="h-12" />}
              {health.data && (
                <>
                  <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                    <span className="text-[12px] text-text-primary">Database</span>
                    <span
                      className={`flex items-center gap-1.5 text-[11px] ${
                        health.data.checks.database === "up" ? "text-success" : "text-danger"
                      }`}
                    >
                      {health.data.checks.database === "up" ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                      {health.data.checks.database === "up" ? "Connected" : "Down"}
                    </span>
                  </div>
                  {health.data.checks.redis && (
                    <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                      <span className="text-[12px] text-text-primary">Redis</span>
                      <span
                        className={`flex items-center gap-1.5 text-[11px] ${
                          health.data.checks.redis === "up" ? "text-success" : "text-danger"
                        }`}
                      >
                        {health.data.checks.redis === "up" ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        {health.data.checks.redis === "up" ? "Connected" : "Down"}
                      </span>
                    </div>
                  )}
                  {health.data.checks.worker && (
                    <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                      <span className="text-[12px] text-text-primary">Worker</span>
                      <span
                        className={`flex items-center gap-1.5 text-[11px] ${
                          health.data.checks.worker === "up" ? "text-success" : "text-danger"
                        }`}
                      >
                        {health.data.checks.worker === "up" ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        {health.data.checks.worker === "up" ? "Running" : "Down"}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <CardTitle className="text-[14px] text-text-primary flex items-center gap-2">
              <Server className="h-4 w-4" />
              Queue Statistics
            </CardTitle>
            <div className="mt-4 space-y-3">
              {statsQuery.isLoading && <Skeleton className="h-12" />}
              {statsQuery.data && (
                <>
                  <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                    <span className="text-[12px] text-text-primary">Waiting</span>
                    <span className="text-[12px] font-medium text-warning">
                      {statsQuery.data.waiting}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                    <span className="text-[12px] text-text-primary">Active</span>
                    <span className="text-[12px] font-medium text-info">
                      {statsQuery.data.active}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                    <span className="text-[12px] text-text-primary">Completed</span>
                    <span className="text-[12px] font-medium text-success">
                      {statsQuery.data.completed}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                    <span className="text-[12px] text-text-primary">Failed</span>
                    <span className={`text-[12px] font-medium ${statsQuery.data.failed > 0 ? "text-danger" : "text-text-muted"}`}>
                      {statsQuery.data.failed}
                    </span>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {health.data?.version && (
          <div className="mt-4 flex items-center gap-2 text-[11px] text-text-muted">
            <Clock className="h-3.5 w-3.5" />
            Version: {health.data.version}
          </div>
        )}
      </div>
    </AppShell>
  );
}
