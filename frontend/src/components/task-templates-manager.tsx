"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { Plus, Trash2, Play, Copy } from "lucide-react";

interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  goal: string;
  agentMode: string;
  config?: Record<string, unknown>;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

const AGENT_MODES = ["BUILD", "PLAN", "ASK", "REVIEW", "FIX"];

export function TaskTemplatesManager({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: "", description: "", goal: "", agentMode: "BUILD" });
  const [error, setError] = useState("");

  const templatesQuery = useQuery({
    queryKey: ["task-templates", workspaceId],
    queryFn: () => apiFetch<TaskTemplate[]>(`/v1/workspaces/${workspaceId}/task-templates`),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string; goal: string; agentMode: string }) =>
      apiFetch(`/v1/workspaces/${workspaceId}/task-templates`, { method: "POST", json: data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task-templates", workspaceId] });
      setShowCreateForm(false);
      setNewTemplate({ name: "", description: "", goal: "", agentMode: "BUILD" });
    },
    onError: (err) => { setError(err instanceof Error ? err.message : String(err)); },
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiFetch(`/v1/workspaces/${workspaceId}/task-templates/${templateId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task-templates", workspaceId] });
    },
  });

  const useTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiFetch<{ taskId: string }>(
        `/v1/workspaces/${workspaceId}/task-templates/${templateId}/use`,
        { method: "POST", json: {} }
      ),
    onSuccess: (result) => {
      router.push(`/tasks/${result.taskId}`);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (template: TaskTemplate) =>
      apiFetch(`/v1/workspaces/${workspaceId}/task-templates`, {
        method: "POST",
        json: { name: `${template.name} (Copy)`, description: template.description, goal: template.goal, agentMode: template.agentMode, config: template.config },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task-templates", workspaceId] });
    },
  });

  const templates = templatesQuery.data ?? [];
  const creating = createMutation.isPending;

  function handleCreate() {
    if (!newTemplate.name.trim() || !newTemplate.goal.trim()) return;
    setError("");
    createMutation.mutate(newTemplate);
  }

  function handleDelete(templateId: string) {
    deleteMutation.mutate(templateId);
  }

  function handleUseTemplate(templateId: string) {
    useTemplateMutation.mutate(templateId);
  }

  function handleDuplicate(template: TaskTemplate) {
    duplicateMutation.mutate(template);
  }

  if (templatesQuery.isLoading) return <div className="text-text-muted p-4">Loading templates...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Task Templates</h2>
        <Button size="sm" onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Template
        </Button>
      </div>

      {showCreateForm && (
        <Card className="p-4 space-y-3">
          <h3 className="font-medium text-text-primary">Create Template</h3>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-name">Name</Label>
            <Input id="tmpl-name" value={newTemplate.name} onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })} placeholder="e.g., Fix lint errors" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-desc">Description (optional)</Label>
            <Input id="tmpl-desc" value={newTemplate.description} onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })} placeholder="Brief description" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-goal">Goal</Label>
            <Input id="tmpl-goal" value={newTemplate.goal} onChange={(e) => setNewTemplate({ ...newTemplate, goal: e.target.value })} placeholder="The task goal/prompt" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-mode">Agent Mode</Label>
            <select id="tmpl-mode" value={newTemplate.agentMode} onChange={(e) => setNewTemplate({ ...newTemplate, agentMode: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text-primary">
              {AGENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={creating}>{creating ? "Creating..." : "Create"}</Button>
            <Button variant="ghost" onClick={() => setShowCreateForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {templates.length === 0 ? (
        <p className="text-text-muted text-sm">No templates yet. Create one to save reusable task prompts.</p>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => (
            <Card key={template.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-text-primary truncate">{template.name}</h3>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary">{template.agentMode}</span>
                    {template.usageCount > 0 && <span className="text-xs text-text-muted">Used {template.usageCount}x</span>}
                  </div>
                  {template.description && <p className="text-sm text-text-secondary mt-1">{template.description}</p>}
                  <p className="text-xs text-text-muted mt-2 line-clamp-2">{template.goal}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleUseTemplate(template.id)} className="p-1 text-text-secondary hover:text-text-primary"><Play className="h-4 w-4" /></button>
                  <button onClick={() => handleDuplicate(template)} className="p-1 text-text-secondary hover:text-text-primary"><Copy className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(template.id)} className="p-1 text-text-secondary hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
