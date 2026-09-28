"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FolderGit2, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { WorkspaceDtoLike } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { CloneProjectDialog } from "@/components/clone-project-dialog";

export default function ProjectsPage() {
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<WorkspaceDtoLike[]>("/v1/workspaces"),
  });

  const allProjects = useQuery({
    queryKey: ["all-projects"],
    enabled: Boolean(workspaces.data?.length),
    queryFn: async () => {
      const wsList = workspaces.data ?? [];
      const results = await Promise.all(
        wsList.map(async (ws) => {
          try {
            const projects = await apiFetch<Array<{ id: string; name: string; connectionType: string; status: string }>>(
              `/v1/workspaces/${ws.id}/projects`,
            );
            return projects.map((p) => ({ ...p, workspaceId: ws.id, workspaceName: ws.name }));
          } catch {
            return [];
          }
        }),
      );
      return results.flat();
    },
  });

  const projects = allProjects.data ?? [];
  const [cloneTarget, setCloneTarget] = useState<{ id: string; name: string; workspaceId: string } | null>(null);

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-h1">Projects</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Code repositories connected to your workspaces
            </p>
          </div>
          <Link href="/workspaces/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New workspace
            </Button>
          </Link>
        </div>

        <div className="mt-5 space-y-2">
          {allProjects.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              what="No projects yet"
              why="Create a workspace and add a project to connect a code repository."
              action={
                <Link href="/workspaces/new">
                  <Button size="sm">Create workspace</Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-1.5">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2 group"
                >
                  <FolderGit2 className="h-4 w-4 text-text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/agent?project=${p.id}`}
                      className="text-[13px] font-medium text-text-primary group-hover:text-brand transition-colors"
                    >
                      {p.name}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {p.workspaceName} · {p.connectionType === "LOCAL_BRIDGE" ? "Local" : "Cloud"}
                    </p>
                  </div>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    p.status === "AVAILABLE" ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
                  )}>
                    {p.status.toLowerCase()}
                  </span>
                  <button
                    onClick={(e) => { e.preventDefault(); setCloneTarget({ id: p.id, name: p.name, workspaceId: p.workspaceId }); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-surface-3"
                  >
                    Clone
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {cloneTarget && (
          <CloneProjectDialog
            open={Boolean(cloneTarget)}
            onOpenChange={(open) => { if (!open) setCloneTarget(null); }}
            project={cloneTarget}
            onSuccess={() => setCloneTarget(null)}
          />
        )}
      </div>
    </AppShell>
  );
}
