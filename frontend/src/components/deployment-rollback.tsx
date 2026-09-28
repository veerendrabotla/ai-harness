"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RotateCcw,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

interface Deployment {
  id: string;
  status: string;
  environment: string;
  deploymentUrl: string | null;
  sourceBranch: string | null;
  createdAt: string;
  deployedAt: string | null;
}

interface DeploymentRollbackProps {
  projectId: string;
  currentDeploymentId: string;
  workspaceId: string;
}

const STATUS_COLORS: Record<string, string> = {
  READY: "bg-success/15 text-success",
  BUILDING: "bg-warning/15 text-warning",
  DEPLOYING: "bg-info/15 text-info",
  FAILED: "bg-danger/15 text-danger",
  QUEUED: "bg-surface-3 text-text-muted",
};

export function DeploymentRollback({
  projectId,
  currentDeploymentId,
}: DeploymentRollbackProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const deployments = useQuery({
    queryKey: ["deployments", projectId],
    queryFn: () =>
      apiFetch<{ deployments: Deployment[] }>(
        `/v1/projects/${projectId}/deployments?limit=10`,
      ),
  });

  const rollbackMutation = useMutation({
    mutationFn: (targetDeploymentId: string) =>
      apiFetch(`/v1/projects/${projectId}/deployments/${targetDeploymentId}/rollback`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["deployments", projectId] });
      setMessage({ type: "success", text: "Rollback initiated successfully" });
      setTimeout(() => setMessage(null), 3000);
    },
    onError: () => {
      setMessage({ type: "error", text: "Failed to initiate rollback" });
    },
  });

  const pastDeployments = (deployments.data?.deployments ?? []).filter(
    (d) => d.id !== currentDeploymentId && d.status === "READY",
  );

  return (
    <Card className="p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-text-muted" />
          <CardTitle className="text-[13px]">Rollback to Previous Deployment</CardTitle>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        )}
      </button>

      {message && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${
            message.type === "success"
              ? "bg-success/10 text-success border border-success/20"
              : "bg-danger/10 text-danger border border-danger/20"
          }`}
        >
          {message.type === "success" ? (
            <Check className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2">
          {deployments.isLoading && <Skeleton className="h-20" />}

          {pastDeployments.length === 0 && !deployments.isLoading && (
            <p className="text-[12px] text-text-muted text-center py-4">
              No previous deployments available for rollback
            </p>
          )}

          {pastDeployments.map((dep) => (
            <div
              key={dep.id}
              className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      STATUS_COLORS[dep.status] ?? "bg-surface-3 text-text-muted"
                    }`}
                  >
                    {dep.status}
                  </span>
                  {dep.sourceBranch && (
                    <span className="text-[11px] text-text-muted font-mono">
                      {dep.sourceBranch}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-text-muted">
                  {dep.deployedAt
                    ? `Deployed ${new Date(dep.deployedAt).toLocaleString()}`
                    : `Created ${new Date(dep.createdAt).toLocaleString()}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={rollbackMutation.isPending}
                onClick={() => rollbackMutation.mutate(dep.id)}
                className="gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                Rollback
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
