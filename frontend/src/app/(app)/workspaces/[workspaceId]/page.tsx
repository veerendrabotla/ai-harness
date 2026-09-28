"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Plus, ListTodo, FolderKanban, ScrollText, Archive, RotateCcw, UserPlus } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ProjectDtoLike, TaskDtoLike, WorkspaceDtoLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, StateBadge } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/states";

export default function WorkspaceDetailPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [archiving, setArchiving] = useState(false);

  const wsQuery = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () =>
      apiFetch<WorkspaceDtoLike & { memberCount: number; projectCount: number; viewerRole: string }>(
        `/v1/workspaces/${workspaceId}`,
      ),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: () => apiFetch<ProjectDtoLike[]>(`/v1/workspaces/${workspaceId}/projects`),
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", workspaceId],
    queryFn: () => apiFetch<TaskDtoLike[]>(`/v1/tasks?workspaceId=${workspaceId}`),
  });

  const isOwner = wsQuery.data?.viewerRole === "OWNER";

  async function toggleArchive() {
    if (!wsQuery.data) return;
    setArchiving(true);
    try {
      const action = wsQuery.data.status === "ARCHIVED" ? "unarchive" : "archive";
      await apiFetch(`/v1/workspaces/${workspaceId}/${action}`, { method: "POST", json: {} });
      await Promise.all([wsQuery.refetch(), tasksQuery.refetch()]);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">{wsQuery.data?.name ?? "Workspace"}</h1>
          <p className="mt-1 text-[12px] text-text-muted">
            {wsQuery.data?.status === "ARCHIVED"
              ? "Archived — task execution is disabled until restored."
              : `${wsQuery.data?.memberCount ?? 0} members · ${wsQuery.data?.projectCount ?? 0} projects`}
          </p>
        </div>
        <div className="flex gap-2">
          {isOwner ? (
            <Button asChild variant="secondary">
              <Link href={`/workspaces/${workspaceId}/invites`}>
                <UserPlus className="h-4 w-4" aria-hidden /> Invites
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link href={`/workspaces/${workspaceId}/settings`}>
              <ScrollText className="h-4 w-4" aria-hidden /> Instructions & policy
            </Link>
          </Button>
          {isOwner ? (
            <Button variant="danger" loading={archiving} onClick={() => void toggleArchive()}>
              {wsQuery.data?.status === "ARCHIVED" ? (
                <>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Restore
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" aria-hidden /> Archive
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="proj-h">
          <CardHeader>
            <CardTitle id="proj-h">Projects</CardTitle>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-brand">
              <Link href={`/workspaces/${workspaceId}/projects/new`}>
                <Plus className="h-4 w-4" aria-hidden /> Add
              </Link>
            </Button>
          </CardHeader>
          {projectsQuery.isLoading ? (
            <Skeleton />
          ) : projectsQuery.data && projectsQuery.data.length > 0 ? (
            <ul className="space-y-2">
              {projectsQuery.data.map((p) => (
                <li key={p.id} className="rounded-lg border border-border bg-surface-1 px-4 py-3">
                  <p className="font-medium">{p.name}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-text-muted">{p.rootReference}</p>
                  <p className="mt-1 text-xs text-text-secondary">{p.status}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              what="No projects connected"
              why="Connect a repository or a Local Bridge project root so agents have something to work on."
            />
          )}
        </section>

        <section aria-labelledby="task-h">
          <CardHeader>
            <CardTitle id="task-h">Tasks</CardTitle>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-brand">
              <Link href={`/workspaces/${workspaceId}/tasks/new`}>
                <ListTodo className="h-4 w-4" aria-hidden /> New task
              </Link>
            </Button>
          </CardHeader>
          {tasksQuery.isLoading ? (
            <Skeleton />
          ) : tasksQuery.data && tasksQuery.data.length > 0 ? (
            <ul className="space-y-2">
              {tasksQuery.data.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3 hover:border-border-strong"
                  >
                    <span className="truncate text-sm">{t.goal}</span>
                    <StateBadge state={t.state} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              what="No tasks yet"
              why="Create a task with a goal; the agent will plan it for your approval first."
              action={
                <Button asChild>
                  <Link href={`/workspaces/${workspaceId}/tasks/new`}>Create task</Link>
                </Button>
              }
            />
          )}
        </section>
      </div>

      <Card className="mt-8 border-dashed">
        <FolderKanban className="h-5 w-5 text-text-muted" aria-hidden />
        <p className="mt-2 text-sm text-text-muted">
          Workspace-scoped views (activity, changes, git, MCP) live in the sidebar of each project and task.
        </p>
      </Card>
      </div>
    </AppShell>
  );
}
