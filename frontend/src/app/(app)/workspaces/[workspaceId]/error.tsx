"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";

export default function WorkspaceDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Workspace Detail Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/15">
          <AlertCircle className="h-6 w-6 text-danger" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Failed to load workspace
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          The workspace could not be loaded. It may have been deleted or you may not have access.
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
            href="/workspaces"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Workspaces
          </Link>
        </div>
      </div>
    </div>
  );
}
