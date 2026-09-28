"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Building2,
  BarChart3,
  Shield,
  Search,
  RefreshCw,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { formatNumber } from "@/lib/utils";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
}

interface AdminWorkspace {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  _count: { members: number; projects: number };
}

interface SystemStats {
  users: number;
  workspaces: number;
  projects: number;
  tasks: number;
  activeTasks: number;
  deployments: number;
}

interface PlatformUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  totalCalls: number;
}

export default function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"users" | "workspaces" | "stats">("stats");
  const [searchQuery, setSearchQuery] = useState("");

  const isAdmin = user?.platformRole === "PLATFORM_ADMIN";

  const stats = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiFetch<SystemStats>("/v1/admin/stats"),
    enabled: isAdmin,
  });

  const usage = useQuery({
    queryKey: ["admin", "usage"],
    queryFn: () => apiFetch<PlatformUsage>("/v1/admin/usage"),
    enabled: isAdmin,
  });

  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: AdminUser[]; total: number }>("/v1/admin/users?limit=100"),
    enabled: isAdmin && activeTab === "users",
  });

  const workspaces = useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: () => apiFetch<{ workspaces: AdminWorkspace[]; total: number }>("/v1/admin/workspaces?limit=100"),
    enabled: isAdmin && activeTab === "workspaces",
  });

  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/v1/admin/users/${userId}/deactivate`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setDeactivateError(null);
    },
    onError: (err) => {
      setDeactivateError(err instanceof Error ? err.message : "Failed to deactivate user");
    },
  });

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="px-6 py-5 pb-24 mx-auto max-w-3xl">
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
            <Shield className="h-12 w-12 text-text-muted mb-4" />
            <h1 className="text-h1">Access Denied</h1>
            <p className="mt-1 text-[13px] text-text-muted">
              You need Platform Admin access to view this page.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const filteredUsers = (users.data?.users ?? []).filter(
    (u) =>
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.displayName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Admin Panel</h1>
            <p className="mt-1 text-[12px] text-text-muted">Platform administration and monitoring</p>
          </div>
        </div>

        <div className="mt-6 flex gap-2 border-b border-border pb-px">
          {(["stats", "users", "workspaces"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-[12px] font-medium rounded-t-lg transition-colors ${
                activeTab === tab
                  ? "bg-surface-2 text-brand border-b-2 border-brand"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-1"
              }`}
            >
              {tab === "stats" && <BarChart3 className="inline h-3.5 w-3.5 mr-1.5" />}
              {tab === "users" && <Users className="inline h-3.5 w-3.5 mr-1.5" />}
              {tab === "workspaces" && <Building2 className="inline h-3.5 w-3.5 mr-1.5" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {activeTab === "stats" && (
            <div className="space-y-4">
              {(stats.isError || usage.isError) && (
                <ErrorState
                  error="Failed to load admin data"
                  onRetry={() => {
                    stats.refetch();
                    usage.refetch();
                  }}
                />
              )}

              {stats.isLoading && <Skeleton className="h-32" />}

              {usage.isLoading && <Skeleton className="h-32" />}

              {stats.data && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Users", value: stats.data.users },
                    { label: "Workspaces", value: stats.data.workspaces },
                    { label: "Projects", value: stats.data.projects },
                    { label: "Tasks", value: stats.data.tasks },
                  ].map((stat) => (
                    <Card key={stat.label} className="p-4">
                      <CardTitle className="text-[11px] text-text-muted">{stat.label}</CardTitle>
                      <p className="mt-1 text-[22px] font-bold text-text-primary">
                        {formatNumber(stat.value)}
                      </p>
                    </Card>
                  ))}
                </div>
              )}

              {usage.data && (
                <Card className="p-4">
                  <CardTitle className="text-[12px] text-text-muted">Platform Usage (All Time)</CardTitle>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-[11px] text-text-muted">Total Tokens</p>
                      <p className="text-[16px] font-bold text-text-primary">
                        {formatNumber(usage.data.totalTokens)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-text-muted">Input Tokens</p>
                      <p className="text-[16px] font-bold text-text-primary">
                        {formatNumber(usage.data.inputTokens)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-text-muted">Output Tokens</p>
                      <p className="text-[16px] font-bold text-text-primary">
                        {formatNumber(usage.data.outputTokens)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-text-muted">Total Cost</p>
                      <p className="text-[16px] font-bold text-text-primary">
                        ${usage.data.estimatedCost.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {activeTab === "users" && (
            <div className="space-y-4">
              {deactivateError && (
                <ErrorState error={deactivateError} />
              )}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-surface-1 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus-visible:outline-none"
                  />
                </div>
                <Button
                  onClick={() => users.refetch()}
                  variant="secondary"
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>

              {users.isLoading && <Skeleton className="h-48" />}

              {users.data && (
                <Card className="overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-surface-2">
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">User</th>
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">Status</th>
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">Joined</th>
                        <th className="text-right px-4 py-2.5 text-text-muted font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="border-b border-border last:border-0 hover:bg-surface-1">
                          <td className="px-4 py-3">
                            <p className="font-medium text-text-primary">{u.displayName}</p>
                            <p className="text-text-muted">{u.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                u.status === "ACTIVE"
                                  ? "bg-success/15 text-success"
                                  : "bg-surface-3 text-text-muted"
                              }`}
                            >
                              {u.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text-muted">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => {
                                if (confirm(`Deactivate ${u.email}?`)) {
                                  deactivateMutation.mutate(u.id);
                                }
                              }}
                              className="text-[11px] text-danger hover:underline"
                            >
                              Deactivate
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-2.5 border-t border-border text-[11px] text-text-muted bg-surface-2">
                    Showing {filteredUsers.length} of {users.data.total} users
                  </div>
                </Card>
              )}
            </div>
          )}

          {activeTab === "workspaces" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-text-muted">
                  {workspaces.data?.total ?? 0} workspaces total
                </p>
                <Button
                  onClick={() => workspaces.refetch()}
                  variant="secondary"
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>

              {workspaces.isLoading && <Skeleton className="h-48" />}

              {workspaces.data && (
                <Card className="overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-surface-2">
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">Workspace</th>
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">Status</th>
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">Members</th>
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">Projects</th>
                        <th className="text-left px-4 py-2.5 text-text-muted font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspaces.data.workspaces.map((ws) => (
                        <tr key={ws.id} className="border-b border-border last:border-0 hover:bg-surface-1">
                          <td className="px-4 py-3">
                            <p className="font-medium text-text-primary">{ws.name}</p>
                            <p className="text-text-muted text-[11px]">{ws.id.slice(0, 8)}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                ws.status === "ACTIVE"
                                  ? "bg-success/15 text-success"
                                  : "bg-surface-3 text-text-muted"
                              }`}
                            >
                              {ws.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text-primary">{ws._count.members}</td>
                          <td className="px-4 py-3 text-text-primary">{ws._count.projects}</td>
                          <td className="px-4 py-3 text-text-muted">
                            {new Date(ws.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
