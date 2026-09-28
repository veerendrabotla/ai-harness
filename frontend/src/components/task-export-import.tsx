"use client";

import { useCallback, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

interface ExportedTask {
  task: {
    id: string;
    goal: string;
    state: string;
    workspaceId: string;
    projectId: string;
    agentMode: string;
    selectedModelMode: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  };
  runs: Array<{
    id: string;
    runNumber: number;
    state: string;
    startedAt: string | null;
    endedAt: string | null;
    modelUsed: string | null;
  }>;
  events: Array<{
    sequenceNumber: number;
    eventType: string;
    actorType: string;
    createdAt: string;
  }>;
}

interface TaskExportImportProps {
  taskId?: string;
  workspaceId?: string;
  mode: "single" | "workspace";
  onImported?: () => void;
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TaskExportImport({ taskId, workspaceId, mode, onImported }: TaskExportImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ExportedTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    try {
      if (mode === "single" && taskId) {
        const data = await apiFetch<ExportedTask>(`/v1/tasks/${taskId}/export`);
        downloadJson(data, `task-${taskId}.json`);
      } else if (mode === "workspace" && workspaceId) {
        const data = await apiFetch<ExportedTask[]>(`/v1/tasks/export/workspace/${workspaceId}`);
        downloadJson(data, `workspace-${workspaceId}-tasks.json`);
      }
    } catch {
      setError("Export failed");
    }
  }, [taskId, workspaceId, mode]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ExportedTask | ExportedTask[];
      const items = Array.isArray(parsed) ? parsed : [parsed];
      setPreview(items);
    } catch {
      setError("Invalid JSON file");
    } finally {
      setImporting(false);
    }
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!preview || preview.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      if (mode === "workspace" && workspaceId) {
        await apiFetch(`/v1/tasks/import/workspace/${workspaceId}`, {
          method: "POST",
          json: { tasks: preview, targetProjectId: preview[0]?.task.projectId },
        });
      } else if (mode === "single" && taskId) {
        await apiFetch(`/v1/tasks/${taskId}/import`, {
          method: "POST",
          json: { targetWorkspaceId: workspaceId },
        });
      }
      setPreview(null);
      onImported?.();
    } catch {
      setError("Import failed");
    } finally {
      setImporting(false);
    }
  }, [preview, mode, taskId, workspaceId, onImported]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export{mode === "workspace" ? " all" : ""}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} loading={importing}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}

      {preview && preview.length > 0 && (
        <Card className="space-y-3">
          <CardTitle className="text-sm">Import Preview ({preview.length} task{preview.length > 1 ? "s" : ""})</CardTitle>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {preview.map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                <p className="text-xs font-medium text-text-primary truncate">{item.task.goal}</p>
                <p className="text-[11px] text-text-muted">
                  {item.task.agentMode} · {item.runs.length} run{item.runs.length !== 1 ? "s" : ""} · {item.events.length} event{item.events.length !== 1 ? "s" : ""}
                </p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" loading={importing} onClick={handleConfirmImport}>
              Confirm import
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
