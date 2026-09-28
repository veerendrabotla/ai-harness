"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { EventLike, TaskDtoLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

/** Workspace-level activity feed: merged recent events across the latest tasks. */
export default function WorkspaceActivityPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const tasksQuery = useQuery({
    queryKey: ["ws-tasks", workspaceId],
    queryFn: () => apiFetch<TaskDtoLike[]>(`/v1/tasks?workspaceId=${workspaceId}`),
  });

  const taskIds = (tasksQuery.data ?? []).slice(0, 8).map((t) => t.id);

  const eventsQuery = useQuery({
    queryKey: ["ws-events", workspaceId, taskIds.join(",")],
    enabled: taskIds.length > 0,
    queryFn: async () => {
      const all = await Promise.all(
        taskIds.map((id) => apiFetch<EventLike[]>(`/v1/tasks/${id}/events?limit=25`)),
      );
      return all
        .flat()
        .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
        .slice(0, 100);
    },
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <h1 className="text-h1">Workspace activity</h1>
      <p className="mt-1 text-[12px] text-text-muted">
        Chronological runtime events across your most recent tasks.
      </p>

      <div className="mt-6 space-y-2">
        {tasksQuery.isLoading || eventsQuery.isLoading ? (
          <Skeleton />
        ) : eventsQuery.isError ? (
          <ErrorState error={eventsQuery.error} onRetry={() => void eventsQuery.refetch()} />
        ) : (eventsQuery.data ?? []).length === 0 ? (
          <EmptyState what="No activity yet" why="Events appear as soon as tasks start running." />
        ) : (
          (eventsQuery.data ?? []).map((e) => (
            <Card key={`${e.taskId}-${e.id}`} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <code className="font-mono text-xs font-semibold">{e.eventType}</code>
                <span className="ml-2 text-xs text-text-muted">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <a href={`/tasks/${e.taskId}`} className="shrink-0 text-xs text-brand hover:underline">
                open task →
              </a>
            </Card>
          ))
        )}
      </div>
      </div>
    </AppShell>
  );
}
