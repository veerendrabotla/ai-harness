"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Users,
  FolderKanban,
  ArrowLeft,
  Loader2,
  Trash2,
  Settings,
  Shield,
  Check,
  Save,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface OrgMember {
  role: string;
  user: { id: string; email: string; displayName: string; avatarUrl: string | null };
}

interface OrgWorkspace {
  id: string;
  name: string;
  status: string;
  _count: { members: number; projects: number };
}

interface OrgSettings {
  scimEnabled: boolean;
  defaultRole: string;
  allowedDomains: string[];
  requireSso: boolean;
  ipAllowlist: string[];
}

interface OrgSettingsApi {
  scimEnabled: boolean;
  ssoEnforced: boolean;
  ipAllowlist: string[];
}

interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  ownerId: string;
  createdAt: string;
  members: OrgMember[];
  workspaces: OrgWorkspace[];
}

export default function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = use(params);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "settings">("overview");
  const [settingsForm, setSettingsForm] = useState<OrgSettings>({
    scimEnabled: false,
    defaultRole: "MEMBER",
    allowedDomains: [],
    requireSso: false,
    ipAllowlist: [],
  });
  const [newDomain, setNewDomain] = useState("");
  const [newIp, setNewIp] = useState("");
  const [saveMessage, setSaveMessage] = useState(false);

  const org = useQuery({
    queryKey: ["organization", orgId],
    queryFn: () => apiFetch<OrgDetails>(`/v1/organizations/${orgId}`),
  });

  const settingsQuery = useQuery({
    queryKey: ["org-settings", orgId],
    queryFn: () => apiFetch<OrgSettingsApi>(`/v1/organizations/${orgId}/settings`),
    enabled: activeTab === "settings",
  });

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setSettingsForm((prev) => ({
      ...prev,
      scimEnabled: s.scimEnabled,
      requireSso: s.ssoEnforced,
      ipAllowlist: s.ipAllowlist,
    }));
  }, [settingsQuery.data]);

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiFetch(`/v1/organizations/${orgId}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organization", orgId] });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (settings: OrgSettings) =>
      apiFetch(`/v1/organizations/${orgId}/settings`, {
        method: "PATCH",
        json: {
          scimEnabled: settings.scimEnabled,
          ssoEnforced: settings.requireSso,
          ipAllowlist: settings.ipAllowlist,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org-settings", orgId] });
      setSaveMessage(true);
      setTimeout(() => setSaveMessage(false), 2000);
    },
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        <Link
          href="/organizations"
          className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Organizations
        </Link>

        {org.isLoading && (
          <>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96 mb-6" />
            <Skeleton className="h-48" />
          </>
        )}

        {org.isError && (
          <ErrorState error="Failed to load organization" onRetry={() => org.refetch()} />
        )}

        {org.data && (
          <>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-brand">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-h1">
                  {org.data.name}
                </h1>
                {org.data.description && (
                  <p className="text-[12px] text-text-muted">{org.data.description}</p>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-6 flex items-center gap-1 border-b border-border">
              <button
                onClick={() => setActiveTab("overview")}
                className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
                  activeTab === "overview"
                    ? "border-brand text-brand"
                    : "border-transparent text-text-muted hover:text-text-primary"
                }`}
              >
                <Users className="inline h-3.5 w-3.5 mr-1.5" />
                Overview
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
                  activeTab === "settings"
                    ? "border-brand text-brand"
                    : "border-transparent text-text-muted hover:text-text-primary"
                }`}
              >
                <Settings className="inline h-3.5 w-3.5 mr-1.5" />
                Settings
              </button>
            </div>

            {activeTab === "overview" && (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                  <CardTitle className="text-[12px] text-text-muted flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Members ({org.data.members.length})
                  </CardTitle>
                  <div className="mt-3 space-y-2">
                    {org.data.members.map((m) => (
                      <div
                        key={m.user.id}
                        className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-text-primary truncate">
                            {m.user.displayName}
                          </p>
                          <p className="text-[11px] text-text-muted truncate">{m.user.email}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-text-muted bg-surface-3 rounded-full px-2 py-0.5">
                            {m.role}
                          </span>
                           {m.user.id !== org.data?.ownerId && (
                             <button
                               onClick={() => {
                                 if (confirm(`Remove ${m.user.displayName}?`)) {
                                   removeMemberMutation.mutate(m.user.id);
                                 }
                               }}
                               className="text-text-muted hover:text-danger transition-colors"
                               aria-label={`Remove ${m.user.displayName}`}
                             >
                               <Trash2 className="h-3.5 w-3.5" />
                             </button>
                           )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-4">
                  <CardTitle className="text-[12px] text-text-muted flex items-center gap-1.5">
                    <FolderKanban className="h-3.5 w-3.5" />
                    Workspaces ({org.data.workspaces.length})
                  </CardTitle>
                  <div className="mt-3 space-y-2">
                    {org.data.workspaces.length === 0 && (
                      <p className="text-[11px] text-text-muted py-4 text-center">
                        No workspaces linked yet
                      </p>
                    )}
                    {org.data.workspaces.map((ws) => (
                      <Link
                        key={ws.id}
                        href={`/workspaces/${ws.id}`}
                        className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 hover:bg-surface-3 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-text-primary">{ws.name}</p>
                          <div className="flex items-center gap-2 text-[11px] text-text-muted mt-0.5">
                            <span>{ws._count.members} members</span>
                            <span>{ws._count.projects} projects</span>
                          </div>
                        </div>
                        <span
                          className={`text-[11px] rounded-full px-2 py-0.5 ${
                            ws.status === "ACTIVE"
                              ? "bg-success/15 text-success"
                              : "bg-surface-3 text-text-muted"
                          }`}
                        >
                          {ws.status}
                        </span>
                      </Link>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {activeTab === "settings" && (
              <div className="mt-6 space-y-4">
                <Card className="p-5">
                  <CardTitle className="text-[14px] text-text-primary flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Security Settings
                  </CardTitle>
                  <div className="mt-4 space-y-4">
                    <label className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3 cursor-pointer">
                      <div>
                        <p className="text-[13px] font-medium text-text-primary">SCIM Provisioning</p>
                        <p className="text-[11px] text-text-muted">Enable automatic user provisioning via SCIM</p>
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={settingsForm.scimEnabled}
                          onChange={(e) =>
                            setSettingsForm((prev) => ({ ...prev, scimEnabled: e.target.checked }))
                          }
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-surface-3 rounded-full peer-checked:bg-brand transition-colors" />
                        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-4 transition-transform shadow-sm" />
                      </div>
                    </label>

                    <label className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3 cursor-pointer">
                      <div>
                        <p className="text-[13px] font-medium text-text-primary">Require SSO</p>
                        <p className="text-[11px] text-text-muted">Force all members to authenticate via SSO</p>
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={settingsForm.requireSso}
                          onChange={(e) =>
                            setSettingsForm((prev) => ({ ...prev, requireSso: e.target.checked }))
                          }
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-surface-3 rounded-full peer-checked:bg-brand transition-colors" />
                        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-4 transition-transform shadow-sm" />
                      </div>
                    </label>

                    <div>
                      <label className="text-[11px] text-text-muted">Default Role</label>
                      <select
                        value={settingsForm.defaultRole}
                        onChange={(e) =>
                          setSettingsForm((prev) => ({ ...prev, defaultRole: e.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg"
                      >
                        <option value="VIEWER">Viewer</option>
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </div>
                  </div>
                </Card>

                <Card className="p-5">
                  <CardTitle className="text-[14px] text-text-primary">Allowed Email Domains</CardTitle>
                  <p className="mt-1 text-[12px] text-text-muted">
                    Restrict sign-ups to specific email domains
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      placeholder="example.com"
                      className="flex-1 px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        if (newDomain && !settingsForm.allowedDomains.includes(newDomain)) {
                          setSettingsForm((prev) => ({
                            ...prev,
                            allowedDomains: [...prev.allowedDomains, newDomain],
                          }));
                          setNewDomain("");
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {settingsForm.allowedDomains.map((domain) => (
                      <span
                        key={domain}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-surface-3 rounded-md text-[11px] text-text-primary"
                      >
                        {domain}
                        <button
                          onClick={() =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              allowedDomains: prev.allowedDomains.filter((d) => d !== domain),
                            }))
                          }
                          className="text-text-muted hover:text-danger"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </Card>

                <Card className="p-5">
                  <CardTitle className="text-[14px] text-text-primary">IP Allowlist</CardTitle>
                  <p className="mt-1 text-[12px] text-text-muted">
                    Restrict access to specific IP addresses or CIDR ranges
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      value={newIp}
                      onChange={(e) => setNewIp(e.target.value)}
                      placeholder="192.168.1.0/24"
                      className="flex-1 px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        if (newIp && !settingsForm.ipAllowlist.includes(newIp)) {
                          setSettingsForm((prev) => ({
                            ...prev,
                            ipAllowlist: [...prev.ipAllowlist, newIp],
                          }));
                          setNewIp("");
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {settingsForm.ipAllowlist.map((ip) => (
                      <span
                        key={ip}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-surface-3 rounded-md text-[11px] font-mono text-text-primary"
                      >
                        {ip}
                        <button
                          onClick={() =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              ipAllowlist: prev.ipAllowlist.filter((i) => i !== ip),
                            }))
                          }
                          className="text-text-muted hover:text-danger"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </Card>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => saveSettingsMutation.mutate(settingsForm)}
                    disabled={saveSettingsMutation.isPending}
                    className="gap-1.5"
                  >
                    {saveSettingsMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save Settings
                  </Button>
                  {saveMessage && (
                    <span className="text-[12px] text-success flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Saved
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
