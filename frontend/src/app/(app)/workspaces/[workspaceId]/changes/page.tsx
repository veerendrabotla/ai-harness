"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectPicker } from "@/components/project-picker.js";
import { DiffViewer } from "@/components/ui/diff-viewer.js";
import { EmptyState, ErrorState } from "@/components/ui/states";

export default function WorkspaceChangesPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [projectId, setProjectId] = useState("");
  const [staged, setStaged] = useState(false);

  const query = useQuery({
    queryKey: ["inspect", projectId, "git.diff", staged],
    enabled: Boolean(projectId),
    retry: false,
    queryFn: async (): Promise<Record<string, unknown>> => {
      try {
        return await apiFetch<Record<string, unknown>>(`/v1/projects/${projectId}/inspect`, {
          method: "POST",
          json: { op: "git.diff", args: { staged } },
        });
      } catch (err) {
        throw err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Inspection failed");
      }
    },
    refetchInterval: 15_000,
  });

  const diffText = (query.data as { diff?: string } | undefined)?.diff ?? "";

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1">Changes</h1>
        <div className="flex items-center gap-2">
          <ProjectPicker workspaceId={workspaceId} value={projectId} onChange={setProjectId} />
          <Button size="sm" variant="secondary" onClick={() => setStaged((s) => !s)}>
            {staged ? "Staged" : "Unstaged"}
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {!projectId ? (
          <EmptyState
            what="No project selected"
            why="Pick a Local Bridge project to inspect its working-tree diff."
          />
        ) : query.isLoading ? (
          <Card>Loading diff…</Card>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : diffText.trim().length === 0 ? (
          <EmptyState what="Working tree clean" why="No uncommitted changes on this root right now." />
        ) : (
          <DiffViewer diff={diffText} />
        )}
      </div>
      </div>
    </AppShell>
  );
}
