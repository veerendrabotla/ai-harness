"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Save,
  RotateCcw,
  X,
  Loader2,
  FileCode,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-bg">
      <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
    </div>
  ),
});

/* ─── Types ──────────────────────────────────────────────── */

export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  language: string;
  /** File was deleted by agent while open */
  deleted?: boolean;
}

interface CodeEditorProps {
  projectId: string | null;
  files: OpenFile[];
  activeFile: string | null;
  onFileUpdate: (path: string, content: string) => void;
  onFileSave: (path: string, content: string) => Promise<void>;
  onFileClose: (path: string) => void;
  onActiveChange?: (path: string) => void;
}

/* ─── Editor component ───────────────────────────────────── */

export function CodeEditor({
  projectId,
  files,
  activeFile,
  onFileUpdate,
  onFileSave,
  onFileClose,
}: CodeEditorProps) {
  const editorRef = useRef<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const { toast } = useToast();

  const currentFile = files.find((f) => f.path === activeFile);

  const handleSave = useCallback(async () => {
    if (!currentFile || !projectId) return;
    setSaving(true);
    try {
      await onFileSave(currentFile.path, currentFile.content);
      setLastSaved(new Date());
      toast("File saved", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
    } finally {
      setSaving(false);
    }
  }, [currentFile, projectId, onFileSave, toast]);

  // Ctrl+S save handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (currentFile && currentFile.dirty) {
          void handleSave();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentFile, handleSave]);

  const handleReload = useCallback(async () => {
    if (!currentFile || !projectId) return;
    try {
      const result = await apiFetch<{ content: string }>(`/v1/projects/${projectId}/files/read`, {
        method: "POST",
        json: { path: currentFile.path },
      });
      onFileUpdate(currentFile.path, result.content ?? "");
      toast("File reloaded", { variant: "success" });
    } catch {
      toast("Failed to reload", { variant: "error" });
    }
  }, [currentFile, projectId, onFileUpdate, toast]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!currentFile || value === undefined) return;
    onFileUpdate(currentFile.path, value);
  }, [currentFile, onFileUpdate]);

  const handleEditorMount = useCallback((editor: unknown) => {
    editorRef.current = editor;
    // Add Ctrl+S handler to editor
    const ed = editor as { addAction: (opts: { id: string; label: string; keybindings: number[]; run: () => void }) => void };
    ed.addAction({
      id: "save-file",
      label: "Save File",
      keybindings: [2048 | 49], // Ctrl+S / Cmd+S
      run: () => { void handleSave(); },
    });
  }, [handleSave]);

  // Warn before close with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const hasDirty = files.some((f) => f.dirty);
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [files]);

  if (!activeFile || !currentFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-bg text-text-muted">
        <FileCode className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-[12px]">Select a file to edit</p>
        <p className="text-[11px] mt-1 text-text-disabled">Click a file in the explorer or from agent changes</p>
      </div>
    );
  }

  if (currentFile.deleted) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-bg text-text-muted">
        <FileCode className="h-8 w-8 mb-2 text-danger opacity-50" />
        <p className="text-[12px] text-danger">File deleted by agent</p>
        <p className="text-[11px] mt-1 text-text-disabled">{currentFile.path}</p>
        <button
          type="button"
          onClick={() => onFileClose(currentFile.path)}
          className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-3 transition-colors"
        >
          Close tab
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Editor toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0 bg-surface-1">
        <span className="text-[11px] font-mono text-text-secondary truncate flex-1">{currentFile.path}</span>
        <span className="text-[11px] text-text-muted uppercase">{currentFile.language}</span>
        {currentFile.dirty && <span className="text-[11px] text-warning font-medium">Unsaved</span>}
        {lastSaved && !currentFile.dirty && (
          <span className="text-[11px] text-success">Saved {lastSaved.toLocaleTimeString()}</span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleReload()}
            className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors"
            title="Reload from disk"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!currentFile.dirty || saving}
            className={cn(
              "rounded p-1 transition-colors",
              currentFile.dirty && !saving ? "text-brand hover:bg-brand/10" : "text-text-disabled",
            )}
            title="Save (Ctrl+S)"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => {
              if (currentFile.dirty) {
                if (!window.confirm("Unsaved changes will be lost. Close anyway?")) return;
              }
              onFileClose(currentFile.path);
            }}
            className="rounded p-1 text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
            title="Close file"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <MonacoEditor
          key={currentFile.path}
          language={currentFile.language}
          value={currentFile.content}
          theme="vs-dark"
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            lineNumbers: "on",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 8 },
            renderLineHighlight: "all",
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            smoothScrolling: true,
            bracketPairColorization: { enabled: true },
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            readOnly: false,
          }}
        />
      </div>
    </div>
  );
}

/* ─── File tab bar component ─────────────────────────────── */

export function FileTabBar({
  files,
  activeFile,
  onTabClick,
  onTabClose,
}: {
  files: OpenFile[];
  activeFile: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div className="flex items-center overflow-x-auto scrollbar-none border-t border-border bg-surface-1 shrink-0">
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          onClick={() => onTabClick(f.path)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border-r border-border shrink-0 transition-colors group",
            activeFile === f.path ? "bg-bg text-text-primary" : "text-text-muted hover:bg-surface-2",
          )}
        >
          {f.dirty && <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />}
          <span className="truncate max-w-[120px]">{f.path.split("/").pop()}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (f.dirty && !window.confirm("Unsaved changes will be lost. Close anyway?")) return;
              onTabClose(f.path);
            }}
            className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-surface-3 transition-all"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </button>
      ))}
    </div>
  );
}
