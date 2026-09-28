"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

interface WorkspaceMember {
  id: string;
  userId: string;
  displayName: string | null;
  email: string;
  role: string;
  createdAt: string;
}

interface Workspace {
  id: string;
  name: string;
  viewerRole?: string;
}

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export default function MembersPage() {
  const qc = useQueryClient();
  const [selectedWs, setSelectedWs] = useState<string>("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("MEMBER");
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string>("");
  const [removeError, setRemoveError] = useState<ApiError | null>(null);
  const [updateRoleError, setUpdateRoleError] = useState<ApiError | null>(null);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Workspace[]>("/v1/workspaces"),
  });

  const wsId = selectedWs || workspaces.data?.[0]?.id || "";

  const members = useQuery({
    queryKey: ["workspace-members", wsId],
    enabled: Boolean(wsId),
    queryFn: () => apiFetch<WorkspaceMember[]>(`/v1/workspaces/${wsId}/members`),
  });

  const currentWs = workspaces.data?.find((w) => w.id === wsId);
  const isOwner = currentWs?.viewerRole === "OWNER";

  const addMutation = useMutation({
    mutationFn: async () => {
      return apiFetch(`/v1/workspaces/${wsId}/members`, {
        method: "POST",
        json: { email: addEmail, role: addRole },
      });
    },
    onSuccess: async () => {
      setShowAddForm(false);
      setAddEmail("");
      setAddRole("MEMBER");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["workspace-members", wsId] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Failed to add member")),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiFetch(`/v1/workspaces/${wsId}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoveError(null);
      void qc.invalidateQueries({ queryKey: ["workspace-members", wsId] });
    },
    onError: (err) => setRemoveError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Failed to remove member")),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      apiFetch(`/v1/workspaces/${wsId}/members/${memberId}`, {
        method: "PATCH",
        json: { role },
      }),
    onSuccess: async () => {
      setEditingMember(null);
      setUpdateRoleError(null);
      await qc.invalidateQueries({ queryKey: ["workspace-members", wsId] });
    },
    onError: (err) => setUpdateRoleError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Failed to update role")),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-h1">Team Members</h1>
          {isOwner ? (
            <Button onClick={() => setShowAddForm((v) => !v)}>
              <Plus className="h-4 w-4" aria-hidden /> Add member
            </Button>
          ) : null}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <label htmlFor="ws-members" className="text-sm text-text-secondary">Workspace</label>
          {workspaces.isLoading ? (
            <Skeleton className="h-9 w-48" />
          ) : (
            <select
              id="ws-members"
              value={wsId}
              onChange={(e) => setSelectedWs(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface-1 px-2 text-sm"
            >
              {(workspaces.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
        </div>

        {showAddForm && isOwner ? (
          <Card className="mt-6 max-w-xl space-y-4">
            {formError ? <ErrorState error={formError} /> : null}
            <Field label="Email" htmlFor="add-email" required>
              <Input id="add-email" type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="member@example.com" />
            </Field>
            <Field label="Role" htmlFor="add-role" required>
              <select
                id="add-role"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2">
              <Button loading={addMutation.isPending} disabled={!addEmail} onClick={() => addMutation.mutate()}>
                Add member
              </Button>
              <Button variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </Card>
        ) : null}

        <div className="mt-8 space-y-3">
          {removeError && <ErrorState error={removeError} />}
          {updateRoleError && <ErrorState error={updateRoleError} />}
          {!wsId ? (
            <EmptyState what="No workspace selected" why="Create a workspace first to manage members." />
          ) : members.isLoading ? (
            <Skeleton />
          ) : members.isError ? (
            <ErrorState error={members.error} onRetry={() => void members.refetch()} />
          ) : (members.data ?? []).length === 0 ? (
            <EmptyState
              what="No members yet"
              why="Add team members to collaborate in this workspace."
            />
          ) : (
            (members.data ?? []).map((m) => (
              <Card key={m.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{m.displayName || m.email}</p>
                  <p className="text-xs text-text-muted">
                    {m.email} · joined {new Date(m.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {editingMember === m.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        className="h-8 rounded-lg border border-border bg-surface-1 px-2 text-xs"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        onClick={() => updateRoleMutation.mutate({ memberId: m.id, role: editRole })}
                        loading={updateRoleMutation.isPending}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingMember(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs font-medium text-text-secondary">{m.role}</span>
                      {isOwner && m.role !== "OWNER" ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingMember(m.id);
                              setEditRole(m.role);
                            }}
                            aria-label={`Edit ${m.displayName || m.email}`}
                          >
                            <Pencil className="h-3 w-3" aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label={`Remove ${m.displayName || m.email}`}
                            loading={removeMutation.isPending && removeMutation.variables === m.id}
                            onClick={() => { if (window.confirm(`Remove ${m.displayName || m.email}?`)) removeMutation.mutate(m.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
