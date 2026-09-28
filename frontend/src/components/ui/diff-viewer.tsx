"use client";

/** Unified-diff viewer: reconstructs old/new sides and renders Monaco's DiffEditor
 *  (lazy-loaded); falls back to the lightweight renderer while Monaco loads. */
import dynamic from "next/dynamic";
import { useMemo } from "react";

interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk" | "file";
  text: string;
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  return diff.split("\n").map((line) => {
    if (line.startsWith("diff --git")) return { type: "file" as const, text: line.replace("diff --git a/", "").replace(/ b\/.*$/, "") };
    if (line.startsWith("@@")) return { type: "hunk" as const, text: line };
    if (line.startsWith("+")) return { type: "add" as const, text: line.slice(1) };
    if (line.startsWith("-")) return { type: "del" as const, text: line.slice(1) };
    return { type: "ctx" as const, text: line.replace(/^ /, "") };
  });
}

const STYLES: Record<DiffLine["type"], string> = {
  file: "text-brand font-semibold pt-3",
  hunk: "text-info bg-surface-2/60",
  add: "bg-success/10 text-success",
  del: "bg-danger/10 text-danger",
  ctx: "text-text-secondary",
};

function LightRenderer({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
      <pre className="min-w-full p-3 font-mono text-xs leading-5">
        {lines.map((l, i) => (
          <div key={i} className={`whitespace-pre px-2 ${STYLES[l.type]}`}>
            {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

const MonacoDiff = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), {
  ssr: false,
  loading: () => null,
});

export function DiffViewer({ diff }: { diff: string }) {
  const lines = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const { original, modified } = useMemo(() => {
    let o = "";
    let m = "";
    for (const l of lines) {
      if (l.type === "file" || l.type === "hunk") continue;
      if (l.type !== "add") o += l.text + "\n";
      if (l.type !== "del") m += l.text + "\n";
    }
    return { original: o, modified: m };
  }, [lines]);

  return (
    <div className="space-y-2">
      <LightRenderer lines={lines} />
      <details>
        <summary className="cursor-pointer select-none text-xs text-text-muted hover:text-text-secondary">
          Open side-by-side diff (Monaco)
        </summary>
        <div className="mt-2 h-[420px] overflow-hidden rounded-lg border border-border">
          <MonacoDiff
            original={original}
            modified={modified}
            language="plaintext"
            theme="vs-dark"
            options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12 }}
          />
        </div>
      </details>
    </div>
  );
}
