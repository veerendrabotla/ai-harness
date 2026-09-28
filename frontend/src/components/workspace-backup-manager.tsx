"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { Download, Trash2, RotateCcw, Plus } from "lucide-react";
import { formatRelative as timeAgo } from "@/lib/utils";

interface BackupEntry {
  id: string;
  createdAt: string;
  sizeBytes: number;
  projectCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspaceBackupManager() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchBackups = useCallback(async (wid: string) => {
    try {
      const data = await apiFetch<BackupEntry[]>(`/v1/workspaces/${wid}/backups`);
      setBackups(data);
    } catch {
      setError("Failed to load backups");
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const workspaces = await apiFetch<Array<{ id: string }>>("/v1/workspaces");
        if (workspaces.length > 0) {
          const wid = workspaces[0].id;
          setWorkspaceId(wid);
          await fetchBackups(wid);
        }
      } catch {
        setError("Failed to load workspace");
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchBackups]);

  async function handleCreateBackup() {
    if (!workspaceId) return;
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/backup`, { method: "POST" });
      setSuccess("Backup created successfully");
      setTimeout(() => setSuccess(""), 3000);
      await fetchBackups(workspaceId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleRestore(backupId: string) {
    if (!workspaceId) return;
    setRestoringId(backupId);
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/restore`, {
        method: "POST",
        json: { backupId, confirm: true },
      });
      setSuccess("Workspace restored from backup");
      setTimeout(() => setSuccess(""), 3000);
      setConfirmRestore(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoringId(null);
    }
  }

  async function handleDelete(backupId: string) {
    if (!workspaceId) return;
    setError("");
    try {
      await apiFetch(`/v1/workspaces/${workspaceId}/backups/${backupId}`, {
        method: "DELETE",
      });
      await fetchBackups(workspaceId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDownload(backup: BackupEntry) {
    if (!workspaceId) return;
    try {
      const data = await apiFetch<Record<string, unknown>>(`/v1/workspaces/${workspaceId}/backups/${backup.id}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${backup.id}-${new Date(backup.createdAt).toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1">Workspace Backups</h1>
            <p className="mt-0.5 text-[12px] text-text-muted">
              Create, restore, and manage workspace snapshots
            </p>
          </div>
          <Button size="sm" onClick={handleCreateBackup} loading={creating}>
            <Plus className="h-4 w-4 mr-1" /> Create Backup
          </Button>
        </div>

        {success && <p className="mt-3 text-xs text-success">{success}</p>}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <Card className="mt-6 p-5">
          <CardTitle>Recent Backups</CardTitle>
          {backups.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">No backups yet. Create one to get started.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-1/50 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">
                      Backup {backup.id.slice(0, 8)}...
                    </p>
                    <p className="text-xs text-text-muted">
                      {timeAgo(backup.createdAt)} &middot; {formatBytes(backup.sizeBytes)} &middot;{" "}
                      {backup.projectCount} project{backup.projectCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {confirmRestore === backup.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleRestore(backup.id)}
                          loading={restoringId === backup.id}
                        >
                          Confirm Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmRestore(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmRestore(backup.id)}
                          title="Restore"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDownload(backup)}
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(backup.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
