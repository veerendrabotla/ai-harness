"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./button";

/** Error state with category, summary, retry, request ID (guidelines §7). */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const apiError = error as { code?: string; message?: string; requestId?: string };
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-5">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <span className="text-sm font-semibold">{apiError?.code ?? "INTERNAL_ERROR"}</span>
      </div>
      <p className="text-sm text-text-secondary">
        {apiError?.message ?? "Something went wrong while loading this view."}
      </p>
      {apiError?.requestId ? (
        <p className="font-mono text-xs text-text-muted">Request ID: {apiError.requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" onClick={onRetry} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  what,
  why,
  action,
}: {
  what: string;
  why: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface-1/50 px-6 py-12 text-center">
      <h3 className="text-h3 text-text-primary">{what}</h3>
      <p className="max-w-md text-sm text-text-muted">{why}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center py-16 text-text-muted">
      <span
        aria-hidden
        className="mr-2 inline-block h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-brand"
      />
      {label}…
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-2 ${className ?? "h-6 w-full"}`} />;
}
