"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/15">
          <AlertCircle className="h-6 w-6 text-danger" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          An error occurred while loading this page. You can try again or return to the dashboard.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-[#0B1020] hover:bg-brand-hover transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
        {error.digest && (
          <p className="mt-4 text-xs text-text-muted">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
