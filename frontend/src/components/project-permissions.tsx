"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Plus, Trash2, Shield } from "lucide-react";

interface ProjectPermission {
  id: string;
  permission: string;
  createdAt: string;
  user: { id: string; email: string; displayName?: string };
}

const PERMISSIONS = [
  { value: "VIEW", label: "View", description: "Can view project and deployments" },
  { value: "EDIT", label: "Edit", description: "Can modify project settings and create tasks" },
  { value: "DEPLOY", label: "Deploy", description: "Can trigger deployments" },
];

export function ProjectPermissions({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPermission, setNewPermission] = useState("VIEW");
  const [error, setError] = useState("");
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;

  const permissionsQuery = useQuery({
    queryKey: ["project-permissions", projectId],
    queryFn: () => apiFetch<ProjectPermission[]>(`/v1/projects/${projectId}/permissions`),
  });

  const addMutation = useMutation({
    mutationFn: async ({ email, permission }: { email: string; permission: string }) => {
      const users = await apiFetch<{ id: string; email: string }[]>(`/v1/admin/users?search=${encodeURIComponent(email)}`);
      const target = users.find((u) => u.email === email);
      if (!target) throw new Error("User not found with that email");
      return apiFetch(`/v1/projects/${projectId}/permissions`, { method: "POST", json: { userId: target.id, permission } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-permissions", projectId] });
      setShowAddForm(false);
      setNewEmail("");
      setNewPermission("VIEW");
    },
    onError: (err) => { setError(err instanceof Error ? err.message : String(err)); },
  });

  const revokeMutation = useMutation({
    mutationFn: (permissionId: string) =>
      apiFetch(`/v1/projects/${projectId}/permissions/${permissionId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-permissions", projectId] });
    },
  });

  const permissions = permissionsQuery.data ?? [];
  const adding = addMutation.isPending;

  function handleAdd() {
    if (!newEmail.trim()) return;
    setError("");
    addMutation.mutate({ email: newEmail, permission: newPermission });
  }

  function handleRevoke(permissionId: string) {
    revokeMutation.mutate(permissionId);
  }

  function permBadge(p: string) {
    if (p === "DEPLOY") return "bg-info/15 text-info";
    if (p === "EDIT") return "bg-brand/15 text-brand";
    return "bg-surface-3 text-text-secondary";
  }

  if (permissionsQuery.isLoading) return <div className="text-text-muted text-sm p-2">Loading permissions...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-primary flex items-center gap-1">
          <Shield className="h-4 w-4" /> Team Permissions
        </h4>
        <button onClick={() => setShowAddForm(true)} className="p-1 text-text-secondary hover:text-text-primary">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {showAddForm && (
        <Card className="p-3 space-y-2">
          <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="User email" type="email" />
          <select value={newPermission} onChange={(e) => setNewPermission(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text-primary">
            {PERMISSIONS.map((p) => <option key={p.value} value={p.value}>{p.label} - {p.description}</option>)}
          </select>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={adding}>{adding ? "Adding..." : "Add"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {permissions.length === 0 ? (
        <p className="text-text-muted text-xs">No team permissions configured.</p>
      ) : (
        <div className="space-y-2">
          {permissions.map((perm) => (
            <div key={perm.id} className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary">{perm.user.displayName || perm.user.email}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${permBadge(perm.permission)}`}>{perm.permission}</span>
                </div>
                <button onClick={() => handleRevoke(perm.id)} className="p-1 text-text-muted hover:text-danger" disabled={perm.user.id === userId}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
