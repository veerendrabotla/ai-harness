"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { WorkspaceDtoLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

export default function WorkspacesPage() {
  const query = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<WorkspaceDtoLike[]>("/v1/workspaces"),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-h1">Workspaces</h1>
        <Button asChild>
          <Link href="/workspaces/new">
            <Plus className="h-4 w-4" aria-hidden /> New workspace
          </Link>
        </Button>
      </div>

      <div className="mt-6">
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton />
            <Skeleton />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data!.length === 0 ? (
          <EmptyState
            what="No workspaces yet"
            why="Workspaces isolate repositories, instructions and policies. Create one to start assigning tasks."
            action={
              <Button asChild>
                <Link href="/workspaces/new">Create workspace</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {query.data!.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workspaces/${w.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-1 px-4 py-4 hover:border-border-strong"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{w.name}</p>
                    <p className="mt-0.5 truncate text-xs text-text-muted">
                      {w.executionMode} · created {new Date(w.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${w.status === "ARCHIVED" ? "bg-state-cancelled/15 text-state-cancelled" : "bg-success/15 text-success"}`}>
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                    {w.status === "ARCHIVED" ? "Archived" : "Active"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </AppShell>
  );
}
