"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ProjectPicker } from "@/components/project-picker.js";
import { EmptyState, ErrorState } from "@/components/ui/states";

export default function WorkspaceGitPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [projectId, setProjectId] = useState("");

  const query = useQuery({
    queryKey: ["inspect", projectId, "git.status"],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Record<string, unknown>> => {
      return apiFetch(`/v1/projects/${projectId}/inspect`, { method: "POST", json: { op: "git.status" } });
    },
    refetchInterval: 15_000,
  });

  const data = query.data as { branch?: string; clean?: boolean; raw?: string } | undefined;
  const rows = (data?.raw ?? "").split("\n").filter(Boolean);

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1">Git</h1>
        <ProjectPicker workspaceId={workspaceId} value={projectId} onChange={setProjectId} />
      </div>

      <div className="mt-6 space-y-4">
        {!projectId ? (
          <EmptyState what="No project selected" why="Pick a Local Bridge project to view repository status." />
        ) : query.isLoading ? (
          <Card>Loading…</Card>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <div className="mb-3 text-sm">
              Branch: <code className="font-mono text-info">{data?.branch}</code>{" "}
              <span className={data?.clean ? "text-success" : "text-warning"}>
                · {data?.clean ? "clean" : "dirty"}
              </span>
            </div>
            {rows.length === 0 ? (
              <EmptyState what="No pending changes" why="The working tree matches HEAD." />
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {rows.map((r) => (
                  <li key={r} className="rounded border border-border bg-surface-1 px-3 py-1.5 text-text-secondary">
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      </div>
    </AppShell>
  );
}
