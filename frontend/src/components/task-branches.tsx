"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { apiFetch } from "@/lib/api-client";
import { Plus, Trash2, GitBranch } from "lucide-react";

interface TaskBranch {
  id: string;
  name: string;
  parentRunId?: string;
  status: string;
  createdAt: string;
}

interface TaskBranchesProps {
  taskId: string;
}

export function TaskBranches({ taskId }: TaskBranchesProps) {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const branchesQuery = useQuery({
    queryKey: ["task-branches", taskId],
    queryFn: () => apiFetch<TaskBranch[]>(`/v1/tasks/${taskId}/branches`),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<TaskBranch>(`/v1/tasks/${taskId}/branches`, {
        method: "POST",
        json: { name },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task-branches", taskId] });
      setNewBranchName("");
      setShowCreateForm(false);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ branchId, status }: { branchId: string; status: string }) =>
      apiFetch<TaskBranch>(`/v1/tasks/${taskId}/branches/${branchId}`, {
        method: "PATCH",
        json: { status },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task-branches", taskId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (branchId: string) =>
      apiFetch(`/v1/tasks/${taskId}/branches/${branchId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task-branches", taskId] });
    },
  });

  const branches = branchesQuery.data ?? [];
  const creating = createMutation.isPending;

  function handleCreate() {
    if (!newBranchName.trim()) return;
    createMutation.mutate(newBranchName.trim());
  }

  function handleUpdateStatus(branchId: string, status: string) {
    updateStatusMutation.mutate({ branchId, status });
  }

  function handleDelete(branchId: string) {
    deleteMutation.mutate(branchId);
  }

  function getStatusColor(status: string) {
    switch (status) {
      case "ACTIVE": return "bg-success/15 text-success";
      case "MERGED": return "bg-info/15 text-info";
      case "ABANDONED": return "bg-surface-3 text-text-muted";
      default: return "bg-surface-3 text-text-muted";
    }
  }

  if (branchesQuery.isLoading) {
    return <div className="text-text-muted text-sm p-2">Loading branches...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-primary flex items-center gap-1">
          <GitBranch className="h-4 w-4" /> Branches
        </h4>
        <button
          onClick={() => setShowCreateForm(true)}
          className="p-1 text-text-secondary hover:text-text-primary"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {showCreateForm && (
        <div className="flex gap-2">
          <Input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="Branch name"
            className="flex-1"
          />
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(false)}>
            Cancel
          </Button>
        </div>
      )}

      {branches.length === 0 ? (
        <p className="text-text-muted text-xs">No branches.</p>
      ) : (
        <div className="space-y-2">
          {branches.map((branch) => (
            <div key={branch.id} className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-text-primary">{branch.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(branch.status)}`}>
                    {branch.status}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {branch.status === "ACTIVE" && (
                    <>
                      <button
                        onClick={() => handleUpdateStatus(branch.id, "MERGED")}
                        className="text-xs text-text-secondary hover:text-text-primary px-1"
                      >
                        Merge
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(branch.id, "ABANDONED")}
                        className="text-xs text-text-secondary hover:text-text-primary px-1"
                      >
                        Abandon
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(branch.id)}
                    className="p-1 text-text-muted hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
