"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { formatRelative as timeAgo } from "@/lib/utils";

interface HealthCheckRecord {
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
}

interface ProviderHealth {
  id: string;
  providerType: string;
  displayName: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  checkedAt: string;
  avgLatencyMs: number;
  uptimePercent: number;
  lastCheckAt: string | null;
  totalChecks: number;
  history?: HealthCheckRecord[];
}

function statusColor(p: ProviderHealth): string {
  if (!p.ok) return "bg-danger";
  if (p.latencyMs > 3000 || p.uptimePercent < 80) return "bg-warning";
  return "bg-success";
}

function statusLabel(p: ProviderHealth): string {
  if (!p.ok) return "Unhealthy";
  if (p.latencyMs > 3000 || p.uptimePercent < 80) return "Degraded";
  return "Healthy";
}

function BarChart({ history }: { history: HealthCheckRecord[] }) {
  if (history.length === 0) return <span className="text-xs text-text-muted">No data</span>;
  const maxLatency = Math.max(...history.map((h) => h.latencyMs), 1);
  return (
    <div className="flex items-end gap-1 h-10">
      {history.map((h, i) => {
        const pct = Math.max((h.latencyMs / maxLatency) * 100, 4);
        return (
          <div
            key={i}
            className={`w-3 rounded-t ${h.ok ? "bg-brand" : "bg-danger"}`}
            style={{ height: `${pct}%` }}
            title={`${h.latencyMs}ms`}
          />
        );
      })}
    </div>
  );
}

export default function ProviderHealthPage() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const query = useQuery({
    queryKey: ["providers-health-summary"],
    queryFn: () => apiFetch<ProviderHealth[]>("/v1/providers/health/summary"),
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["providers-health-summary"] });
  }, [qc]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1">Provider Health</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Real-time health status and latency monitoring for all providers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefresh ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              Auto-refresh {autoRefresh ? "ON" : "OFF"}
            </Button>
            <Button size="sm" variant="outline" onClick={refresh} loading={query.isFetching} aria-label="Refresh">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {query.isLoading ? (
            <>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </>
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : (query.data ?? []).length === 0 ? (
            <Card>
              <p className="text-sm text-text-muted">No provider connections found. Add a provider first.</p>
            </Card>
          ) : (
            (query.data ?? []).map((p) => (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusColor(p)}`} />
                    <div>
                      <CardTitle className="text-base">{p.displayName}</CardTitle>
                      <p className="text-xs text-text-muted">{p.providerType}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-medium text-text-primary">{statusLabel(p)}</span>
                    <p className="text-[11px] text-text-muted">{p.latencyMs}ms</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-lg font-semibold text-text-primary">{p.avgLatencyMs}</p>
                    <p className="text-[11px] text-text-muted">Avg latency (ms)</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-text-primary">{p.uptimePercent}%</p>
                    <p className="text-[11px] text-text-muted">Uptime</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-text-primary">{p.totalChecks}</p>
                    <p className="text-[11px] text-text-muted">Checks</p>
                  </div>
                </div>

                {p.history && p.history.length > 0 && (
                  <div className="mt-4 flex items-end gap-4">
                    <div className="flex-1">
                      <p className="mb-1 text-[11px] text-text-muted">Last {p.history.length} checks</p>
                      <BarChart history={p.history} />
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-text-muted">Last check</p>
                      <p className="text-xs text-text-primary">{p.lastCheckAt ? timeAgo(p.lastCheckAt) : "Never"}</p>
                    </div>
                  </div>
                )}

                {p.detail && (
                  <p className="mt-2 text-[11px] text-text-muted truncate">{p.detail}</p>
                )}
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
