"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FolderGit2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { ProjectPermissions } from "@/components/project-permissions";
import { CloneProjectDialog } from "@/components/clone-project-dialog";
import { ProjectMemoryViewer } from "@/components/project-memory-viewer";

interface ProjectDetail {
  id: string;
  name: string;
  workspaceId: string;
  connectionType: string;
  repositoryUrl?: string;
  rootReference?: string;
  defaultBranch?: string;
  status: string;
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const [showClone, setShowClone] = useState(false);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiFetch<ProjectDetail>(`/v1/projects/${projectId}`),
  });

  const project = projectQuery.data;

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        {project ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FolderGit2 className="h-5 w-5 text-text-muted" />
                  <h1 className="text-h1">{project.name}</h1>
                </div>
                <p className="mt-1 text-[12px] text-text-muted">
                  {project.connectionType === "LOCAL_BRIDGE" ? "Local" : "Cloud"} project
                  {project.repositoryUrl ? ` · ${project.repositoryUrl}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowClone(true)}>
                  Clone
                </Button>
                <Button variant="ghost" size="sm" onClick={() => router.push(`/agent?project=${projectId}`)}>
                  Open in Agent
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Project Details</CardTitle>
                </CardHeader>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Status</span>
                    <span className={project.status === "AVAILABLE" ? "text-success" : "text-danger"}>
                      {project.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Connection</span>
                    <span className="text-text-secondary">{project.connectionType}</span>
                  </div>
                  {project.defaultBranch && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Default Branch</span>
                      <span className="text-text-secondary font-mono">{project.defaultBranch}</span>
                    </div>
                  )}
                  {project.rootReference && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Root Reference</span>
                      <span className="text-text-secondary font-mono">{project.rootReference}</span>
                    </div>
                  )}
                </div>
              </Card>

              <ProjectPermissions projectId={projectId} />

              <ProjectMemoryViewer projectId={projectId} />
            </div>

            <CloneProjectDialog
              open={showClone}
              onOpenChange={setShowClone}
              project={project}
            />
          </>
        ) : projectQuery.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <ErrorState error={projectQuery.error} onRetry={() => void projectQuery.refetch()} />
        )}
      </div>
    </AppShell>
  );
}
