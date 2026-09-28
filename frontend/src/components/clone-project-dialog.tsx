"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { apiFetch } from "@/lib/api-client";

interface Project {
  id: string;
  name: string;
  workspaceId: string;
}

interface Workspace {
  id: string;
  name: string;
}

interface CloneProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onSuccess?: () => void;
}

export function CloneProjectDialog({ open, onOpenChange, project, onSuccess }: CloneProjectDialogProps) {
  const router = useRouter();
  const [name, setName] = useState(`${project.name} (Copy)`);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(project.workspaceId);
  const [error, setError] = useState("");

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Workspace[]>("/v1/workspaces"),
    enabled: open,
    placeholderData: [{ id: project.workspaceId, name: "Current Workspace" }],
  });

  const cloneMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; name: string }>(
        `/v1/projects/${project.id}/clone`,
        { method: "POST", json: { name: name.trim(), workspaceId: targetWorkspaceId } }
      ),
    onSuccess: (result) => {
      onOpenChange(false);
      router.push(`/projects/${result.id}`);
      onSuccess?.();
    },
    onError: (err) => { setError(err instanceof Error ? err.message : String(err)); },
  });

  const workspaces = workspacesQuery.data ?? [];
  const loading = cloneMutation.isPending;

  function handleClone() {
    if (!name.trim()) return;
    setError("");
    cloneMutation.mutate();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-surface-1 rounded-xl border border-border p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">Clone Project</h2>
        <p className="text-sm text-text-secondary">
          Duplicate project settings, secrets, environment variables, and memories to a new project.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="clone-name">Project Name</Label>
            <Input
              id="clone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project (Copy)"
            />
          </div>

          {workspaces.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="clone-ws">Target Workspace</Label>
              <select
                id="clone-ws"
                value={targetWorkspaceId}
                onChange={(e) => setTargetWorkspaceId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text-primary"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            </div>
          )}

          <p className="text-xs text-text-muted">
            Copied: secrets, env vars, project memories. NOT copied: deployments, task history, audit logs.
          </p>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleClone} disabled={loading || !name.trim()}>
            {loading ? "Cloning..." : "Clone Project"}
          </Button>
        </div>
      </div>
    </div>
  );
}
