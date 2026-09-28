"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Plus,
  Search,
  RefreshCw,
  FileCode,
  FileJson,
  FileText,
  FileCog,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  path: string;
  size?: number;
  children?: FileEntry[];
}

interface FileExplorerProps {
  projectId: string | null;
  onFileSelect?: (path: string, content?: string) => void;
  activeFile?: string;
  changedFiles?: Set<string>;
}

function getFileIcon(name: string, isDir: boolean, isOpen?: boolean) {
  if (isDir) return isOpen ? <FolderOpen className="h-3.5 w-3.5 text-info" /> : <Folder className="h-3.5 w-3.5 text-info" />;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-brand" />;
  if (["json"].includes(ext)) return <FileJson className="h-3.5 w-3.5 text-warning" />;
  if (["md", "txt", "rst"].includes(ext)) return <FileText className="h-3.5 w-3.5 text-text-muted" />;
  if (["yaml", "yml", "toml", "env", "config"].includes(ext)) return <FileCog className="h-3.5 w-3.5 text-text-muted" />;
  if (["png", "jpg", "jpeg", "gif", "svg", "ico"].includes(ext)) return <File className="h-3.5 w-3.5 text-success" />;
  return <File className="h-3.5 w-3.5 text-text-muted" />;
}

function FileTreeNode({
  entry,
  depth,
  projectId,
  onFileSelect,
  activeFile,
  changedFiles,
  expandedDirs,
  toggleDir,
}: {
  entry: FileEntry;
  depth: number;
  projectId: string;
  onFileSelect?: (path: string, content?: string) => void;
  activeFile?: string;
  changedFiles?: Set<string>;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
}) {
  const isDir = entry.type === "directory";
  const isOpen = expandedDirs.has(entry.path);
  const isChanged = changedFiles?.has(entry.path);
  const isActive = activeFile === entry.path;

  const handleClick = useCallback(() => {
    if (isDir) {
      toggleDir(entry.path);
    } else if (onFileSelect) {
      onFileSelect(entry.path, "");
    }
  }, [isDir, entry.path, toggleDir, onFileSelect]);

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono hover:bg-surface-2 transition-colors text-left",
          isActive && "bg-brand/10 text-brand",
          !isActive && "text-text-secondary",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isDir && (
          <span className="shrink-0 w-3 h-3 flex items-center justify-center">
            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
        {!isDir && <span className="w-3" />}
        <span className="shrink-0">{getFileIcon(entry.name, isDir, isOpen)}</span>
        <span className={cn("truncate", isChanged && "text-warning font-medium")}>{entry.name}</span>
        {isChanged && <span className="ml-auto text-[11px] text-warning shrink-0">M</span>}
      </button>
      {isDir && isOpen && entry.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          projectId={projectId}
          onFileSelect={onFileSelect}
          activeFile={activeFile}
          changedFiles={changedFiles}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
        />
      ))}
    </div>
  );
}

export function FileExplorer({ projectId, onFileSelect, activeFile, changedFiles }: FileExplorerProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["."]));
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [createDialog, setCreateDialog] = useState<{ parentPath: string; type: "file" | "directory" } | null>(null);
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const files = useQuery({
    queryKey: ["files", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<{ entries: FileEntry[] }>(`/v1/projects/${projectId}/files/list`, {
      method: "POST",
      json: { path: "." },
    }),
    refetchInterval: 30_000,
  });

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleFileClick = useCallback(async (path: string) => {
    if (!projectId) return;
    try {
      const result = await apiFetch<{ content: string }>(`/v1/projects/${projectId}/files/read`, {
        method: "POST",
        json: { path },
      });
      onFileSelect?.(path, result.content ?? "");
    } catch {
      toast("Failed to read file", { variant: "error" });
    }
  }, [projectId, onFileSelect, toast]);

  const handleCreate = useCallback(async () => {
    if (!projectId || !createDialog || !newName.trim()) return;
    const path = createDialog.parentPath === "." ? newName.trim() : `${createDialog.parentPath}/${newName.trim()}`;
    try {
      await apiFetch(`/v1/projects/${projectId}/files/create`, {
        method: "POST",
        json: { path, type: createDialog.type, content: "" },
      });
      toast(`Created ${createDialog.type}`, { variant: "success" });
      setCreateDialog(null);
      setNewName("");
      void qc.invalidateQueries({ queryKey: ["files", projectId] });
    } catch {
      toast("Failed to create", { variant: "error" });
    }
  }, [projectId, createDialog, newName, qc, toast]);

  const handleDelete = useCallback(async () => {
    if (!projectId || !deleteTarget) return;
    try {
      await apiFetch(`/v1/projects/${projectId}/files/delete`, {
        method: "POST",
        json: { path: deleteTarget },
      });
      toast("Deleted", { variant: "success" });
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: ["files", projectId] });
    } catch {
      toast("Failed to delete", { variant: "error" });
    }
  }, [projectId, deleteTarget, qc, toast]);

  const filteredEntries = searchQuery
    ? (files.data?.entries ?? []).filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()) || e.path.toLowerCase().includes(searchQuery.toLowerCase()))
    : files.data?.entries ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Files</span>
        <div className="flex-1" />
        <button type="button" onClick={() => setShowSearch(!showSearch)} className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors" title="Search files" aria-label="Search files">
          <Search className="h-3 w-3" />
        </button>
        <button type="button" onClick={() => void files.refetch()} className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors" title="Refresh" aria-label="Refresh file tree">
          <RefreshCw className={cn("h-3 w-3", files.isLoading && "animate-spin")} />
        </button>
        <button type="button" onClick={() => setCreateDialog({ parentPath: ".", type: "file" })} className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors" title="New file" aria-label="Create new file">
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="px-2 py-1 border-b border-border shrink-0">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full rounded bg-surface-2 px-2 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted"
            aria-label="Filter files"
          />
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {!projectId ? (
          <p className="px-3 py-4 text-center text-[11px] text-text-muted">Select a project to browse files</p>
        ) : files.isLoading ? (
          <div className="px-3 py-4 text-center text-[11px] text-text-muted">Loading files...</div>
        ) : filteredEntries.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-text-muted">
            {searchQuery ? "No matching files" : "No files in project"}
          </p>
        ) : (
          filteredEntries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              projectId={projectId}
              onFileSelect={handleFileClick}
              activeFile={activeFile}
              changedFiles={changedFiles}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
            />
          ))
        )}
      </div>

      {/* Create dialog */}
      {createDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl border border-border bg-surface-1 p-4 w-80 shadow-2xl">
            <h3 className="text-[13px] font-semibold text-text-primary">
              New {createDialog.type === "file" ? "File" : "Folder"}
            </h3>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); if (e.key === "Escape") setCreateDialog(null); }}
              placeholder={createDialog.type === "file" ? "filename.ts" : "folder-name"}
              className="mt-3 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-primary outline-none focus:border-brand"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreateDialog(null)}>Cancel</Button>
              <Button size="sm" onClick={() => void handleCreate()} disabled={!newName.trim()}>Create</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete file?"
        description={`Are you sure you want to delete ${deleteTarget}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
