"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  RefreshCw,
  X,
  Wifi,
  WifiOff,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface MCPServer {
  id: string;
  name: string;
  transportType: string;
  status: string;
  encryptedConfig: string;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  ACTIVE: { icon: <Wifi className="h-3.5 w-3.5" />, color: "text-success", label: "Active" },
  ERROR: { icon: <WifiOff className="h-3.5 w-3.5" />, color: "text-danger", label: "Error" },
  INACTIVE: { icon: <X className="h-3.5 w-3.5" />, color: "text-text-muted", label: "Inactive" },
};

export default function MCPDashboardPage() {
  const queryClient = useQueryClient();

  const servers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => apiFetch<MCPServer[]>("/v1/mcp/servers"),
  });

  const healthCheckMutation = useMutation({
    mutationFn: (serverId: string) =>
      apiFetch<MCPServer>(`/v1/mcp/servers/${serverId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
  });

  const activeServers = (servers.data ?? []).filter((s) => s.status === "ACTIVE");
  const errorServers = (servers.data ?? []).filter((s) => s.status === "ERROR");

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-brand" />
            <div>
              <h1 className="text-h1">
                MCP Server Dashboard
              </h1>
              <p className="mt-1 text-[12px] text-text-muted">
                Monitor Model Context Protocol server health
              </p>
            </div>
          </div>
          <Button
            onClick={() => servers.refetch()}
            variant="secondary"
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4">
            <CardTitle className="text-[11px] text-text-muted">Total Servers</CardTitle>
            <p className="mt-1 text-[24px] font-bold text-text-primary">
              {servers.data?.length ?? 0}
            </p>
          </Card>
          <Card className="p-4">
            <CardTitle className="text-[11px] text-text-muted">Active</CardTitle>
            <p className="mt-1 text-[24px] font-bold text-success">{activeServers.length}</p>
          </Card>
          <Card className="p-4">
            <CardTitle className="text-[11px] text-text-muted">Errors</CardTitle>
            <p className="mt-1 text-[24px] font-bold text-danger">{errorServers.length}</p>
          </Card>
        </div>

        <div className="mt-6">
          {servers.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          )}

          {servers.isError && (
            <ErrorState error="Failed to load MCP servers" onRetry={() => servers.refetch()} />
          )}

          {servers.data && servers.data.length === 0 && (
            <EmptyState
              what="No MCP servers configured"
              why="Add MCP servers in Settings to extend agent capabilities."
            />
          )}

          {servers.data && servers.data.length > 0 && (
            <Card className="overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-left px-4 py-2.5 text-text-muted font-medium">Server</th>
                    <th className="text-left px-4 py-2.5 text-text-muted font-medium">Transport</th>
                    <th className="text-left px-4 py-2.5 text-text-muted font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 text-text-muted font-medium">Created</th>
                    <th className="text-right px-4 py-2.5 text-text-muted font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {servers.data.map((server) => {
                    const statusConfig = STATUS_CONFIG[server.status] ?? STATUS_CONFIG.INACTIVE;
                    return (
                      <tr
                        key={server.id}
                        className="border-b border-border last:border-0 hover:bg-surface-1"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-text-primary">{server.name}</p>
                          <p className="text-text-muted text-[11px] font-mono">{server.id.slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-text-muted">{server.transportType}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1.5 ${statusConfig.color}`}>
                            {statusConfig.icon}
                            {statusConfig.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {new Date(server.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={healthCheckMutation.isPending}
                            onClick={() => healthCheckMutation.mutate(server.id)}
                            className="gap-1"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Check
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
