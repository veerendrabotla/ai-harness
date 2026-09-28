"use client";

import { useQuery } from "@tanstack/react-query";
import { GitBranch, Check, X, Clock, Loader2, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { AppShell } from "@/components/app-shell";

interface TaskRun {
  id: string;
  taskId: string;
  runNumber: number;
  state: string;
  startedAt: string;
  endedAt: string | null;
  modelUsed: string | null;
  task: { id: string; goal: string; state: string; workspaceId: string };
}

interface PipelineStage {
  name: string;
  status: "completed" | "active" | "pending" | "failed";
  duration?: string;
}

function getStagesForRun(run: TaskRun): PipelineStage[] {
  const s = run.state;
  const stages: PipelineStage[] = [
    { name: "Plan", status: s === "QUEUED" || s === "PLANNING" ? "active" : ["EXECUTING", "VERIFYING", "REVIEWING", "COMPLETED"].includes(s) ? "completed" : s === "FAILED" ? "failed" : "pending" },
    { name: "Build", status: s === "EXECUTING" || s === "REPLANNING" ? "active" : ["VERIFYING", "REVIEWING", "COMPLETED"].includes(s) ? "completed" : s === "FAILED" ? "failed" : "pending" },
    { name: "Review", status: s === "VERIFYING" || s === "REVIEWING" ? "active" : s === "COMPLETED" ? "completed" : "pending" },
    { name: "Done", status: s === "COMPLETED" ? "completed" : s === "FAILED" ? "failed" : "pending" },
  ];
  return stages;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <Check className="h-3 w-3 text-success" />,
  active: <Loader2 className="h-3 w-3 text-brand animate-spin" />,
  failed: <X className="h-3 w-3 text-danger" />,
  pending: <Clock className="h-3 w-3 text-text-muted" />,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-success",
  active: "bg-brand",
  failed: "bg-danger",
  pending: "bg-surface-4",
};

export default function PipelinePage() {
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspaces.data?.[0]?.id ?? "";

  const runs = useQuery({
    queryKey: ["task-runs", wsId],
    queryFn: () => apiFetch<{ runs: TaskRun[] }>(`/v1/tasks/runs?limit=20&workspaceId=${wsId}`),
    enabled: Boolean(wsId),
    refetchInterval: 10000,
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <GitBranch className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Pipeline</h1>
            <p className="mt-1 text-[12px] text-text-muted">View task execution pipeline and status</p>
          </div>
        </div>

        {runs.isError && (
          <div className="mt-4">
            <ErrorState error="Failed to load pipeline" onRetry={() => runs.refetch()} />
          </div>
        )}

        {runs.isLoading && <Skeleton className="mt-6 h-64" />}

        {runs.data?.runs && (
          <div className="mt-6 space-y-3">
            {runs.data.runs.map((run) => {
              const stages = getStagesForRun(run);
              return (
                <Card key={run.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-[13px]">{run.task.goal}</CardTitle>
                      <p className="mt-1 text-[11px] text-text-muted">
                        Run #{run.runNumber} &middot; {run.modelUsed ?? "—"} &middot;{" "}
                        {new Date(run.startedAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[11px] rounded-full font-medium ${
                        run.state === "COMPLETED"
                          ? "bg-success/20 text-success"
                          : run.state === "FAILED"
                            ? "bg-danger/20 text-danger"
                            : "bg-brand/20 text-brand"
                      }`}
                    >
                      {run.state}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    {stages.map((stage, i) => (
                      <div key={stage.name} className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center ${STATUS_COLORS[stage.status]}`}>
                            {STATUS_ICONS[stage.status]}
                          </div>
                          <span className="text-[11px] text-text-muted">{stage.name}</span>
                        </div>
                        {i < stages.length - 1 && (
                          <ArrowRight className="h-3 w-3 text-text-muted" />
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
            {runs.data.runs.length === 0 && (
              <p className="text-center text-[12px] text-text-muted py-8">
                No pipeline runs yet. Start a task to see the pipeline.
              </p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
