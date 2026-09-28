import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface-1 p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex items-center justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-h3", className)} {...props} />;
}

const STATE_STYLES: Record<string, { bg: string; text: string }> = {
  QUEUED: { bg: "bg-state-queued/15", text: "text-state-queued" },
  INITIALIZING: { bg: "bg-info/15", text: "text-info" },
  UNDERSTANDING: { bg: "bg-info/15", text: "text-info" },
  GATHERING_CONTEXT: { bg: "bg-info/15", text: "text-info" },
  PLANNING: { bg: "bg-state-planning/15", text: "text-state-planning" },
  WAITING_FOR_APPROVAL: { bg: "bg-warning/15", text: "text-warning" },
  EXECUTING: { bg: "bg-brand/15", text: "text-brand" },
  WAITING_FOR_TOOL_APPROVAL: { bg: "bg-warning/15", text: "text-warning" },
  OBSERVING: { bg: "bg-brand/15", text: "text-brand" },
  REPLANNING: { bg: "bg-state-verifying/20", text: "text-state-verifying" },
  VERIFYING: { bg: "bg-state-verifying/15", text: "text-state-verifying" },
  REVIEWING: { bg: "bg-state-verifying/15", text: "text-state-verifying" },
  COMPLETED: { bg: "bg-success/15", text: "text-success" },
  FAILED: { bg: "bg-danger/15", text: "text-danger" },
  CANCELLED: { bg: "bg-state-cancelled/15", text: "text-state-cancelled" },
  INTERRUPTED: { bg: "bg-state-interrupted/15", text: "text-state-interrupted" },
};

const STATE_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  INITIALIZING: "Initializing",
  UNDERSTANDING: "Understanding",
  GATHERING_CONTEXT: "Gathering context",
  PLANNING: "Planning",
  WAITING_FOR_APPROVAL: "Waiting for approval",
  EXECUTING: "Executing",
  WAITING_FOR_TOOL_APPROVAL: "Waiting for tool approval",
  OBSERVING: "Observing",
  REPLANNING: "Replanning",
  VERIFYING: "Verifying",
  REVIEWING: "Reviewing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  INTERRUPTED: "Interrupted",
};

/** State badge: label + icon + color — never color alone (guidelines §4). */
export function StateBadge({ state, className }: { state: string; className?: string }) {
  const style = STATE_STYLES[state] ?? STATE_STYLES["QUEUED"]!;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        style.bg,
        style.text,
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATE_LABELS[state] ?? state}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, string> = {
    READ: "text-info border-info/40",
    WRITE: "text-warning border-warning/40",
    DESTRUCTIVE: "text-danger border-danger/40",
    EXTERNAL: "text-state-verifying border-state-verifying/40",
  };
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide", map[risk] ?? "")}>
      {risk.toLowerCase()}
    </span>
  );
}
