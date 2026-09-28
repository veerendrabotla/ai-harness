"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { TaskDtoLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { StateBadge } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

export default function TasksPage() {
  const [stateFilter, setStateFilter] = useState<string>("");

  const query = useQuery({
    queryKey: ["tasks", stateFilter],
    queryFn: () => apiFetch<TaskDtoLike[]>(`/v1/tasks${stateFilter ? `?state=${stateFilter}` : ""}`),
    refetchInterval: 5000,
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1">Tasks</h1>
        <label className="text-sm text-text-secondary">
          Filter{" "}
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="ml-2 h-9 rounded-lg border border-border bg-surface-1 px-2 text-sm"
            aria-label="Filter tasks by state"
          >
            <option value="">All states</option>
            {["QUEUED", "PLANNING", "WAITING_FOR_APPROVAL", "EXECUTING", "WAITING_FOR_TOOL_APPROVAL", "COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].map(
              (s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ").toLowerCase()}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      <div className="mt-6">
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton />
            <Skeleton />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState
            what="No tasks found"
            why={
              stateFilter
                ? "No tasks match this filter. Clear the filter or create a new task."
                : "Tasks are created inside a workspace against one of its projects."
            }
          />
        ) : (
          <ul className="space-y-2">
            {query.data!.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tasks/${t.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-1 px-4 py-3.5 hover:border-border-strong"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.goal}</p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {new Date(t.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <StateBadge state={t.state} />
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
