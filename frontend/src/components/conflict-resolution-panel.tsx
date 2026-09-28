"use client";

/**
 * ConflictResolutionPanel — Monaco DiffEditor-based conflict resolution.
 *
 * LEFT (original): User's unsaved local version
 * RIGHT (modified): Agent/Disk version
 *
 * Actions: Keep My Version | Use Agent Version | Save My Version As... | Close Without Resolving
 */
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Save,
  X,
  FileX,
  FileEdit,
} from "lucide-react";

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-bg text-text-muted text-sm">
        Loading diff editor...
      </div>
    ),
  },
);

export interface ConflictFile {
  path: string;
  userContent: string;
  diskContent: string;
  detectedAt: Date;
  /** If the agent deleted this file, diskContent is null */
  agentDeleted?: boolean;
  /** If the agent renamed this file, newPath is the new location */
  agentRenamed?: string;
}

interface ConflictResolutionPanelProps {
  conflict: ConflictFile;
  onKeepMine: (path: string) => void;
  onUseAgentVersion: (path: string) => void;
  onSaveAs?: (path: string, content: string) => void;
  onDismiss: (path: string) => void;
}

export function ConflictResolutionPanel({
  conflict,
  onKeepMine,
  onUseAgentVersion,
  onSaveAs,
  onDismiss,
}: ConflictResolutionPanelProps) {
  const [isResolving, setIsResolving] = useState(false);
  const fileName = conflict.path.split("/").pop() ?? conflict.path;

  const handleKeepMine = useCallback(() => {
    setIsResolving(true);
    try {
      onKeepMine(conflict.path);
    } finally {
      setIsResolving(false);
    }
  }, [conflict.path, onKeepMine]);

  const handleUseAgent = useCallback(() => {
    setIsResolving(true);
    try {
      onUseAgentVersion(conflict.path);
    } finally {
      setIsResolving(false);
    }
  }, [conflict.path, onUseAgentVersion]);

  const handleSaveAs = useCallback(() => {
    if (onSaveAs) {
      // Create a new file with user content
      const newPath = conflict.path.replace(/(\.[^.]+)$/, ".user$1");
      onSaveAs(newPath, conflict.userContent);
    }
  }, [conflict, onSaveAs]);

  // Agent deleted the file — show deletion conflict
  if (conflict.agentDeleted) {
    return (
      <div className="flex flex-col h-full bg-bg">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-warning/5 shrink-0">
          <FileX className="h-4 w-4 text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-text-primary">
              Agent deleted <span className="font-mono">{fileName}</span>
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">
              You have unsaved changes in this file. The agent removed it from disk.
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="font-mono text-[11px] text-text-secondary whitespace-pre-wrap bg-surface-2 rounded-md p-4 max-h-full overflow-auto">
            {conflict.userContent}
          </pre>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-surface-1 shrink-0">
          <button
            type="button"
            onClick={handleKeepMine}
            disabled={isResolving}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-3 transition-colors"
          >
            <Save className="h-3 w-3" />
            Restore My Version
          </button>
          <button
            type="button"
            onClick={() => onDismiss(conflict.path)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-3 transition-colors"
          >
            <X className="h-3 w-3" />
            Close Tab
          </button>
        </div>
      </div>
    );
  }

  // Agent renamed the file — show rename + content diff
  const renamedTo = conflict.agentRenamed ?? "";

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header with warning */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-warning/5 shrink-0">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-text-primary">
            Conflict: <span className="font-mono">{fileName}</span>
            {renamedTo && (
              <span className="text-text-muted">
                {" "}→{" "}
                <span className="font-mono text-info">{renamedTo.split("/").pop()}</span>
                {conflict.userContent !== conflict.diskContent && " (also modified)"}
              </span>
            )}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {renamedTo
              ? "Agent renamed this file. Choose how to resolve."
              : "Agent modified this file while you have unsaved changes."}
          </p>
        </div>
      </div>

      {/* Side-by-side labels */}
      <div className="flex border-b border-border shrink-0">
        <div className="flex-1 px-4 py-1.5 bg-surface-2 border-r border-border">
          <span className="text-[11px] font-medium text-brand uppercase tracking-wider">
            Your Version (unsaved)
          </span>
        </div>
        <div className="flex-1 px-4 py-1.5 bg-surface-1">
          <span className="text-[11px] font-medium text-success uppercase tracking-wider">
            Agent/Disk Version
          </span>
        </div>
      </div>

      {/* Monaco DiffEditor */}
      <div className="flex-1 min-h-0">
        <MonacoDiffEditor
          original={conflict.userContent}
          modified={conflict.diskContent}
          language={detectLanguage(conflict.path)}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            renderLineHighlight: "all",
          }}
        />
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-surface-1 shrink-0">
        <button
          type="button"
          onClick={handleKeepMine}
          disabled={isResolving}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-3 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Keep My Version
        </button>
        <button
          type="button"
          onClick={handleUseAgent}
          disabled={isResolving}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-white hover:bg-brand-hover transition-colors"
        >
          <ArrowRight className="h-3 w-3" />
          Use Agent Version
        </button>
        {onSaveAs && (
          <button
            type="button"
            onClick={handleSaveAs}
            disabled={isResolving}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-3 transition-colors"
          >
            <FileEdit className="h-3 w-3" />
            Save My Version As...
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onDismiss(conflict.path)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-3 transition-colors"
        >
          <X className="h-3 w-3" />
          Close Without Resolving
        </button>
      </div>
    </div>
  );
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
    html: "html", css: "css", scss: "scss", sh: "shell", toml: "toml",
  };
  return map[ext] ?? "plaintext";
}
