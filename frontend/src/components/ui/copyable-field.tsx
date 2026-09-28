"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Secret-looking values are copyable but never selectable-rendered as plain inputs. */
export function CopyableField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const masked = value.length > 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;

  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <code className="flex-1 truncate font-mono text-xs text-text-secondary" title={label}>
        {masked}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label ?? "value"}`}
        className="rounded p-1 text-text-muted hover:text-brand"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
