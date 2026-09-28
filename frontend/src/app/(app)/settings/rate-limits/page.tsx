"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/states";
import { Gauge, Save } from "lucide-react";

interface RateLimitConfig {
  enabled: boolean;
  global: { windowMs: number; maxRequests: number };
  endpoints: Record<string, { windowMs: number; maxRequests: number }>;
}

interface RateLimitUsageEntry {
  userId: string;
  endpoint: string;
  _sum: { currentCount: number | null };
}

interface UserUsage {
  userId: string;
  requests: number;
}

interface RateLimitUsage {
  entries: RateLimitUsageEntry[];
  userBreakdown: UserUsage[];
}

const DEFAULT_CONFIG: RateLimitConfig = {
  enabled: true,
  global: { windowMs: 60_000, maxRequests: 100 },
  endpoints: {
    tasks: { windowMs: 60_000, maxRequests: 30 },
    providers: { windowMs: 60_000, maxRequests: 20 },
    deploy: { windowMs: 300_000, maxRequests: 10 },
  },
};

export default function RateLimitsPage() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<RateLimitConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspaces.data?.[0]?.id ?? "";

  const configQuery = useQuery({
    queryKey: ["rate-limit-config", wsId],
    queryFn: () => apiFetch<RateLimitConfig>(`/v1/workspaces/${wsId}/rate-limits`),
    enabled: Boolean(wsId),
  });

  const usageQuery = useQuery({
    queryKey: ["rate-limit-usage", wsId],
    queryFn: () => apiFetch<RateLimitUsageEntry[]>(`/v1/workspaces/${wsId}/rate-limits/usage`),
    enabled: Boolean(wsId),
  });

  const userBreakdown = (() => {
    const entries = usageQuery.data ?? [];
    const userMap = new Map<string, number>();
    for (const entry of entries) {
      userMap.set(entry.userId, (userMap.get(entry.userId) ?? 0) + (entry._sum.currentCount ?? 0));
    }
    return Array.from(userMap.entries()).map(([userId, requests]) => ({ userId, requests }));
  })();

  const usage: RateLimitUsage | null = usageQuery.data
    ? { entries: usageQuery.data, userBreakdown }
    : null;

  useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data);
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!wsId) throw new Error("No workspace found");
      await apiFetch(`/v1/workspaces/${wsId}/rate-limits`, {
        method: "PUT",
        json: config,
      });
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ["rate-limit-config", wsId] });
    },
  });

  if (configQuery.isLoading) return <AppShell><div className="p-6"><Skeleton className="h-8 w-48" /><Skeleton className="mt-4 h-64 w-full" /></div></AppShell>;

  function updateEndpoint(key: string, field: "windowMs" | "maxRequests", value: number) {
    setConfig({
      ...config,
      endpoints: {
        ...config.endpoints,
        [key]: { ...config.endpoints[key], [field]: value },
      },
    });
  }

  if (configQuery.isLoading) return <AppShell><div className="p-6"><Skeleton className="h-8 w-48" /><Skeleton className="mt-4 h-64 w-full" /></div></AppShell>;

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1 flex items-center gap-2">
              <Gauge className="h-5 w-5" /> Rate Limiting
            </h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Configure per-user API rate limits for your workspace
            </p>
          </div>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1" /> {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>

        {saved && <p className="mt-3 text-xs text-success">Configuration saved successfully.</p>}
        {saveMutation.isError && <p className="mt-3 text-xs text-danger">{saveMutation.error.message}</p>}

        <Card className="mt-6 p-5">
          <CardHeader>
            <CardTitle>Global Limits</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Window</Label>
              <Select value={config.global.windowMs}
                onChange={(e) => setConfig({ ...config, global: { ...config.global, windowMs: Number(e.target.value) } })}>
                <option value={60000}>1 minute</option>
                <option value={300000}>5 minutes</option>
                <option value={600000}>10 minutes</option>
                <option value={3600000}>1 hour</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Max Requests per Window</Label>
              <Input type="number" min="1" value={config.global.maxRequests}
                onChange={(e) => setConfig({ ...config, global: { ...config.global, maxRequests: Number(e.target.value) } })} />
            </div>
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <CardHeader>
            <CardTitle>Endpoint Limits</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            {Object.entries(config.endpoints).map(([key, limits]) => (
              <div key={key} className="grid grid-cols-3 gap-4 items-end">
                <div>
                  <Label className="capitalize">{key}</Label>
                  <p className="text-xs text-text-muted mt-0.5">Endpoint group</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Window</Label>
                  <Select value={limits.windowMs}
                    onChange={(e) => updateEndpoint(key, "windowMs", Number(e.target.value))}>
                    <option value={60000}>1m</option>
                    <option value={300000}>5m</option>
                    <option value={600000}>10m</option>
                    <option value={3600000}>1h</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Max Requests</Label>
                  <Input type="number" min="1" value={limits.maxRequests}
                    onChange={(e) => updateEndpoint(key, "maxRequests", Number(e.target.value))} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <CardHeader>
            <CardTitle>Recent Rate-Limited Requests</CardTitle>
          </CardHeader>
          {usageQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !usage || usage.entries.length === 0 ? (
            <p className="text-sm text-text-muted">No recent rate-limited requests.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th className="pb-2 font-medium">User</th>
                    <th className="pb-2 font-medium">Endpoint</th>
                    <th className="pb-2 font-medium">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.entries.slice(0, 20).map((entry, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 font-mono text-xs">{entry.userId.slice(0, 8)}...</td>
                      <td className="py-2">{entry.endpoint}</td>
                      <td className="py-2">{entry._sum.currentCount ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="mt-4 p-5">
          <CardHeader>
            <CardTitle>Per-User Usage Breakdown</CardTitle>
          </CardHeader>
          {usageQuery.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : !usage || usage.userBreakdown.length === 0 ? (
            <p className="text-sm text-text-muted">No usage data available.</p>
          ) : (
            <div className="space-y-2">
              {usage.userBreakdown.map((user) => (
                <div key={user.userId} className="flex items-center justify-between rounded-lg border border-border bg-surface-1/50 px-4 py-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
                      {user.userId[0]?.toUpperCase() ?? "?"}
                    </div>
                    <span className="font-mono text-xs text-text-secondary">{user.userId.slice(0, 8)}...</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-text-muted">{user.requests} requests</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="mt-4 p-5">
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <ul className="space-y-2 text-sm text-text-secondary">
            <li>Rate limits are tracked per user per workspace per endpoint group.</li>
            <li>When a user exceeds the limit, they receive a 429 response with a Retry-After header.</li>
            <li>Usage is tracked in-memory with periodic persistence to the database.</li>
            <li>Set max requests to a very high value (e.g., 999999) to effectively disable limits for an endpoint.</li>
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
