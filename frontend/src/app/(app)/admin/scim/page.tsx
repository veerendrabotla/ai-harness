"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Copy,
  Check,
  Info,
  Search,
  RefreshCw,
  UserCheck,
  UserX,
  Clock,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface SCIMConfig {
  endpoint: string;
  token: string;
  organizationId: string;
}

interface SCIMUser {
  id: string;
  externalId: string;
  userName: string;
  displayName: string;
  emails: Array<{ value: string; primary: boolean }>;
  active: boolean;
  groups: string[];
  lastModified: string;
  createdAt: string;
}

interface SCIMGroup {
  id: string;
  displayName: string;
  members: string[];
  createdAt: string;
}

interface SCIMSyncEvent {
  id: string;
  eventType: "USER_PROVISIONED" | "USER_UPDATED" | "USER_DEPROVISIONED" | "GROUP_CREATED" | "GROUP_UPDATED";
  resourceType: "User" | "Group";
  resourceId: string;
  resourceName: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  errorMessage?: string;
  createdAt: string;
}

export default function AdminSCIMPage() {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const scimConfig = useQuery({
    queryKey: ["admin", "scim-config"],
    queryFn: async () => {
      try { return await apiFetch<SCIMConfig>("/v1/admin/scim/config"); }
      catch { return null; }
    },
  });

  const scimUsers = useQuery({
    queryKey: ["admin", "scim-users", { optional: true }],
    queryFn: async () => {
      try { return await apiFetch<{ users: SCIMUser[] }>("/v1/admin/scim/users"); }
      catch { return { users: [] }; }
    },
  });

  const scimGroups = useQuery({
    queryKey: ["admin", "scim-groups", { optional: true }],
    queryFn: async () => {
      try { return await apiFetch<{ groups: SCIMGroup[] }>("/v1/admin/scim/groups"); }
      catch { return { groups: [] }; }
    },
  });

  const scimEvents = useQuery({
    queryKey: ["admin", "scim-events", { optional: true }],
    queryFn: async () => {
      try { return await apiFetch<{ events: SCIMSyncEvent[] }>("/v1/admin/scim/events"); }
      catch { return { events: [] }; }
    },
  });

  const scimLoadError = scimUsers.isError || scimGroups.isError || scimEvents.isError;

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const filteredUsers = scimUsers.data?.users?.filter((user) => {
    const matchesSearch =
      !userSearch ||
      user.displayName.toLowerCase().includes(userSearch.toLowerCase()) ||
      user.userName.toLowerCase().includes(userSearch.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && user.active) ||
      (statusFilter === "inactive" && !user.active);
    return matchesSearch && matchesStatus;
  }) ?? [];

  const statusColor = (status: SCIMSyncEvent["status"]) => {
    switch (status) {
      case "SUCCESS": return "text-success";
      case "FAILED": return "text-danger";
      case "PENDING": return "text-warning";
    }
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">SCIM Provisioning</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Enterprise user provisioning via SCIM 2.0 protocol
            </p>
          </div>
        </div>

        {scimLoadError && (
          <div className="mt-4">
            <ErrorState error={scimLoadError} />
          </div>
        )}

        <div className="mt-6 space-y-4">
          {/* Endpoint Config */}
          <Card className="p-5">
            <CardTitle className="text-[14px] text-text-primary">SCIM Endpoint</CardTitle>
            <p className="mt-1 text-[12px] text-text-muted">
              Use this endpoint to configure your identity provider (Okta, Azure AD, etc.)
            </p>

            {scimConfig.isLoading && <Skeleton className="mt-4 h-32" />}

            {scimConfig.data && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-[11px] text-text-muted mb-1">Base URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-lg bg-surface-3 px-3 py-2 text-[12px] font-mono text-text-primary">
                      {scimConfig.data.endpoint}
                    </code>
                    <button
                      onClick={() => copyToClipboard(scimConfig.data!.endpoint, "endpoint")}
                      className="rounded-lg p-2 hover:bg-surface-3 transition-colors"
                    >
                      {copiedField === "endpoint" ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4 text-text-muted" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-text-muted mb-1">Bearer Token</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-lg bg-surface-3 px-3 py-2 text-[12px] font-mono text-text-primary">
                      {scimConfig.data.token}
                    </code>
                    <button
                      onClick={() => copyToClipboard(scimConfig.data!.token, "token")}
                      className="rounded-lg p-2 hover:bg-surface-3 transition-colors"
                    >
                      {copiedField === "token" ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4 text-text-muted" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Provisioned Users */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[14px] text-text-primary">Provisioned Users</CardTitle>
                <p className="mt-1 text-[12px] text-text-muted">
                  Users synced from your identity provider
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted">
                  {filteredUsers.length} users
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => scimUsers.refetch()}
                  disabled={scimUsers.isFetching}
                  aria-label="Refresh users"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${scimUsers.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search users..."
                  className="h-10 w-full rounded-lg border border-border bg-surface-1 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus-visible:outline-none"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {scimUsers.isLoading && <Skeleton className="mt-4 h-40" />}

            {filteredUsers.length > 0 && (
              <div className="mt-4 border border-border rounded-lg overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-surface-2 text-text-muted">
                      <th className="text-left px-3 py-2 font-medium">User</th>
                      <th className="text-left px-3 py-2 font-medium">Email</th>
                      <th className="text-left px-3 py-2 font-medium">Groups</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Last Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="border-t border-border hover:bg-surface-2/50">
                        <td className="px-3 py-2">
                          <div>
                            <p className="font-medium text-text-primary">{user.displayName}</p>
                            <p className="text-[11px] text-text-muted">@{user.userName}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {user.emails.find((e) => e.primary)?.value ?? user.emails[0]?.value}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {user.groups.slice(0, 2).map((g) => (
                              <span key={g} className="px-1.5 py-0.5 bg-surface-3 rounded text-[11px] text-text-muted">
                                {g}
                              </span>
                            ))}
                            {user.groups.length > 2 && (
                              <span className="text-[11px] text-text-muted">+{user.groups.length - 2}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {user.active ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <UserCheck className="h-3 w-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-danger">
                              <UserX className="h-3 w-3" /> Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {new Date(user.lastModified).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filteredUsers.length === 0 && !scimUsers.isLoading && (
              <p className="mt-4 text-[11px] text-text-muted text-center py-6">
                No provisioned users found
              </p>
            )}
          </Card>

          {/* Provisioned Groups */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[14px] text-text-primary">Provisioned Groups</CardTitle>
                <p className="mt-1 text-[12px] text-text-muted">
                  Groups synced from your identity provider
                </p>
              </div>
              <span className="text-[11px] text-text-muted">
                {scimGroups.data?.groups?.length ?? 0} groups
              </span>
            </div>

            {scimGroups.isLoading && <Skeleton className="mt-4 h-20" />}

            {scimGroups.data?.groups && scimGroups.data.groups.length > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {scimGroups.data.groups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2"
                  >
                    <div>
                      <p className="text-[12px] font-medium text-text-primary">{group.displayName}</p>
                      <p className="text-[11px] text-text-muted">{group.members.length} members</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {scimGroups.data?.groups?.length === 0 && !scimGroups.isLoading && (
              <p className="mt-4 text-[11px] text-text-muted text-center py-4">
                No groups provisioned
              </p>
            )}
          </Card>

          {/* Sync Events */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[14px] text-text-primary">Sync Event History</CardTitle>
                <p className="mt-1 text-[12px] text-text-muted">
                  Recent provisioning events and their status
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => scimEvents.refetch()}
                disabled={scimEvents.isFetching}
                aria-label="Refresh events"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scimEvents.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {scimEvents.isLoading && <Skeleton className="mt-4 h-32" />}

            {scimEvents.data?.events && scimEvents.data.events.length > 0 && (
              <div className="mt-4 space-y-2">
                {scimEvents.data.events.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Clock className="h-3.5 w-3.5 text-text-muted" />
                      <div>
                        <p className="text-[12px] font-medium text-text-primary">
                          {event.eventType.replace(/_/g, " ").toLowerCase()} — {event.resourceName}
                        </p>
                        {event.errorMessage && (
                          <p className="text-[11px] text-danger mt-0.5">{event.errorMessage}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] font-medium ${statusColor(event.status)}`}>
                        {event.status}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {scimEvents.data?.events?.length === 0 && !scimEvents.isLoading && (
              <p className="mt-4 text-[11px] text-text-muted text-center py-4">
                No sync events recorded
              </p>
            )}
          </Card>

          <div className="flex items-start gap-2 rounded-lg bg-info/10 border border-info/20 px-4 py-3 text-[12px] text-info">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              SCIM provisioning requires Enterprise plan. Contact support to enable this feature for your
              organization.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
