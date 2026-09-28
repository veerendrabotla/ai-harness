"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { TrendingUp, Coins, Activity, Zap } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";

interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  totalCalls: number;
}

interface ModelUsage {
  modelIdentifier: string;
  providerType: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  callCount: number;
}

interface TaskUsage {
  taskId: string;
  taskGoal: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  callCount: number;
}

interface DailyTrend {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  callCount: number;
}

export default function UsagePage() {
  const [days, setDays] = useState("30");

  const summary = useQuery({
    queryKey: ["usage-summary"],
    queryFn: () => apiFetch<UsageSummary>("/v1/usage"),
  });

  const modelUsage = useQuery({
    queryKey: ["usage-by-model"],
    queryFn: () => apiFetch<ModelUsage[]>("/v1/usage/by-model"),
  });

  const taskUsage = useQuery({
    queryKey: ["usage-by-task"],
    queryFn: () => apiFetch<TaskUsage[]>("/v1/usage/by-task?limit=10"),
  });

  const trend = useQuery({
    queryKey: ["usage-trend", days],
    queryFn: () => apiFetch<DailyTrend[]>(`/v1/usage/trend?days=${days}`),
  });

  const loading = summary.isLoading || modelUsage.isLoading || taskUsage.isLoading || trend.isLoading;
  const error = summary.isError || modelUsage.isError || taskUsage.isError || trend.isError;

  function formatCost(n: number): string {
    return `$${n.toFixed(2)}`;
  }

  return (
    <AppShell>
      <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Token Usage</h1>
          <p className="text-text-muted mt-1">Monitor your AI model consumption and costs</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {error && (
        <ErrorState error="Failed to load usage data. Please try again." onRetry={() => {
          summary.refetch();
          modelUsage.refetch();
          taskUsage.refetch();
          trend.refetch();
        }} />
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {loading ? (
          <>
            <Card><Skeleton className="h-[100px]" /></Card>
            <Card><Skeleton className="h-[100px]" /></Card>
            <Card><Skeleton className="h-[100px]" /></Card>
            <Card><Skeleton className="h-[100px]" /></Card>
          </>
        ) : (
          <>
            <Card>
              <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary">
                <Zap className="h-4 w-4" /> Total Tokens
              </div>
              <div className="text-3xl font-bold">{formatNumber(summary.data?.totalTokens ?? 0)}</div>
              <p className="text-xs text-text-muted mt-1">
                {formatNumber(summary.data?.inputTokens ?? 0)} input / {formatNumber(summary.data?.outputTokens ?? 0)} output
              </p>
            </Card>
            <Card>
              <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary">
                <Coins className="h-4 w-4" /> Estimated Cost
              </div>
              <div className="text-3xl font-bold">{formatCost(summary.data?.estimatedCost ?? 0)}</div>
              <p className="text-xs text-text-muted mt-1">Based on model pricing</p>
            </Card>
            <Card>
              <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary">
                <Activity className="h-4 w-4" /> API Calls
              </div>
              <div className="text-3xl font-bold">{summary.data?.totalCalls ?? 0}</div>
              <p className="text-xs text-text-muted mt-1">Model invocations</p>
            </Card>
            <Card>
              <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary">
                <TrendingUp className="h-4 w-4" /> Avg Tokens/Call
              </div>
              <div className="text-3xl font-bold">
                {summary.data?.totalCalls ? formatNumber(Math.round((summary.data?.totalTokens ?? 0) / summary.data.totalCalls)) : "0"}
              </div>
              <p className="text-xs text-text-muted mt-1">Per model invocation</p>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Usage by Model */}
        <Card>
          <CardTitle>Usage by Model</CardTitle>
          <p className="text-sm text-text-secondary mb-4">Token consumption across different AI models</p>
          {loading ? (
            <Skeleton className="h-[200px]" />
          ) : (modelUsage.data?.length ?? 0) === 0 ? (
            <p className="text-text-muted text-center py-8">No usage data available</p>
          ) : (
            <div className="space-y-3">
              {(modelUsage.data ?? []).slice(0, 5).map((m) => (
                <div key={m.modelIdentifier} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">{m.modelIdentifier}</p>
                    <p className="text-xs text-text-muted">{m.providerType} • {m.callCount} calls</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatNumber(m.totalTokens)} tokens</p>
                    <p className="text-xs text-text-muted">{formatCost(m.estimatedCost)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Usage by Task */}
        <Card>
          <CardTitle>Top Tasks by Usage</CardTitle>
          <p className="text-sm text-text-secondary mb-4">Tasks consuming the most tokens</p>
          {loading ? (
            <Skeleton className="h-[200px]" />
          ) : (taskUsage.data?.length ?? 0) === 0 ? (
            <p className="text-text-muted text-center py-8">No task usage data available</p>
          ) : (
            <div className="space-y-3">
              {(taskUsage.data ?? []).map((t) => (
                <div key={t.taskId} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{t.taskGoal}</p>
                    <p className="text-xs text-text-muted">{t.callCount} calls</p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="font-medium">{formatNumber(t.totalTokens)} tokens</p>
                    <p className="text-xs text-text-muted">{formatCost(t.estimatedCost)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Daily Trend */}
      <Card className="mt-6">
        <CardTitle>Daily Token Usage</CardTitle>
        <p className="text-sm text-text-secondary mb-4">Token consumption over time</p>
        {loading ? (
          <Skeleton className="h-[200px]" />
        ) : (trend.data?.length ?? 0) === 0 ? (
          <p className="text-text-muted text-center py-8">No trend data available</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-right py-2 font-medium">Input Tokens</th>
                  <th className="text-right py-2 font-medium">Output Tokens</th>
                  <th className="text-right py-2 font-medium">Total Tokens</th>
                  <th className="text-right py-2 font-medium">Cost</th>
                  <th className="text-right py-2 font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {(trend.data ?? []).map((d) => (
                  <tr key={d.date} className="border-b border-border last:border-0">
                    <td className="py-2">{d.date}</td>
                    <td className="text-right py-2">{formatNumber(d.inputTokens)}</td>
                    <td className="text-right py-2">{formatNumber(d.outputTokens)}</td>
                    <td className="text-right py-2 font-medium">{formatNumber(d.totalTokens)}</td>
                    <td className="text-right py-2">{formatCost(d.estimatedCost)}</td>
                    <td className="text-right py-2">{d.callCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
    </AppShell>
  );
}
