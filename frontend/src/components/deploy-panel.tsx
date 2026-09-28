"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Rocket,
  RotateCcw,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Loader2,
  History,
  Settings,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DeploymentComments } from "@/components/deployment-comments";

interface DeployPanelProps {
  projectId: string | null;
}

interface Deployment {
  id: string;
  projectId: string;
  providerType: string;
  status: "queued" | "preparing" | "building" | "deploying" | "health_checking" | "ready" | "failed" | "cancelled" | "rolled_back";
  deploymentUrl: string | null;
  previewUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface Provider {
  type: string;
  capabilities: {
    supportsRollback: boolean;
    supportsLogs: boolean;
    supportsPreview: boolean;
    supportsCustomDomains: boolean;
  };
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; bg: string; label: string; spin?: boolean }> = {
  queued: { icon: Clock, color: "text-text-muted", bg: "bg-surface-3", label: "Queued" },
  preparing: { icon: Loader2, color: "text-info", bg: "bg-info/10", label: "Preparing", spin: true },
  building: { icon: Loader2, color: "text-info", bg: "bg-info/10", label: "Building", spin: true },
  deploying: { icon: Loader2, color: "text-warning", bg: "bg-warning/10", label: "Deploying", spin: true },
  health_checking: { icon: Loader2, color: "text-info", bg: "bg-info/10", label: "Health Check", spin: true },
  ready: { icon: CheckCircle, color: "text-success", bg: "bg-success/10", label: "Live" },
  failed: { icon: XCircle, color: "text-danger", bg: "bg-danger/10", label: "Failed" },
  cancelled: { icon: XCircle, color: "text-text-muted", bg: "bg-surface-3", label: "Cancelled" },
  rolled_back: { icon: RotateCcw, color: "text-warning", bg: "bg-warning/10", label: "Rolled Back" },
};

export function DeployPanel({ projectId }: DeployPanelProps) {
  const [deploying, setDeploying] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("self_hosted");
  const [showSettings, setShowSettings] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const providers = useQuery({
    queryKey: ["deployment-providers"],
    queryFn: () => apiFetch<{ providers: Provider[] }>("/v1/deployment-providers"),
  });

  const deployments = useQuery({
    queryKey: ["deployments", projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<Deployment[]>(`/v1/projects/${projectId}/deployments`),
    refetchInterval: 5000,
  });

  const liveDeployment = deployments.data?.find((d) => d.status === "ready");

  const handleDeploy = useCallback(async () => {
    if (!projectId) return;
    setDeploying(true);
    try {
      await apiFetch<{ deploymentId: string; status: string }>(
        `/v1/projects/${projectId}/deploy`,
        {
          method: "POST",
          json: {
            buildCommand: "npm run build",
            environment: "production",
          },
        },
      );
      toast("Deployment started", { variant: "success" });
      void qc.invalidateQueries({ queryKey: ["deployments", projectId] });
    } catch {
      toast("Failed to start deployment", { variant: "error" });
    } finally {
      setDeploying(false);
    }
  }, [projectId, qc, toast]);

  const handleRollback = useCallback(async (deploymentId: string) => {
    if (!projectId) return;
    try {
      await apiFetch(
        `/v1/projects/${projectId}/deployments/${deploymentId}/rollback`,
        { method: "POST" },
      );
      toast("Rollback initiated", { variant: "success" });
      void qc.invalidateQueries({ queryKey: ["deployments", projectId] });
    } catch {
      toast("Rollback failed", { variant: "error" });
    }
  }, [projectId, qc, toast]);

  const handleCancel = useCallback(async (deploymentId: string) => {
    if (!projectId) return;
    try {
      await apiFetch(
        `/v1/projects/${projectId}/deployments/${deploymentId}/cancel`,
        { method: "POST" },
      );
      toast("Deployment cancelled", { variant: "success" });
      void qc.invalidateQueries({ queryKey: ["deployments", projectId] });
    } catch {
      toast("Cancel failed", { variant: "error" });
    }
  }, [projectId, qc, toast]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Rocket className="w-4 h-4" />
          Deploy
        </h3>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1 hover:bg-surface-2 rounded"
          aria-label="Deployment settings"
          aria-expanded={showSettings}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Provider Selection */}
      {showSettings && (
        <div className="p-3 border-b bg-surface-1">
          <label className="text-xs font-medium text-text-muted block mb-1">
            Deployment Provider
          </label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-full text-sm border rounded px-2 py-1.5 bg-surface-0"
            aria-label="Select deployment provider"
          >
            {providers.data?.providers.map((p) => (
              <option key={p.type} value={p.type}>
                {p.type === "self_hosted" ? "Self-Hosted" :
                 p.type === "vercel" ? "Vercel" :
                 p.type === "cloudflare" ? "Cloudflare Pages" :
                 p.type === "railway" ? "Railway" : p.type}
              </option>
            )) ?? <option value="self_hosted">Self-Hosted</option>}
          </select>
        </div>
      )}

      {/* Live Deployment */}
      <div className="p-3 border-b">
        {liveDeployment ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                liveDeployment.status === "ready" ? "bg-success" : "bg-warning"
              )} />
              <span className="text-sm font-medium">Live</span>
              <span className="text-xs text-text-muted">
                {liveDeployment.providerType}
              </span>
            </div>
            {liveDeployment.deploymentUrl && (
              <a
                href={liveDeployment.deploymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-brand hover:underline"
              >
                {liveDeployment.deploymentUrl}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <div className="flex gap-2 mt-2">
              {providers.data?.providers.find(p => p.type === liveDeployment.providerType)?.capabilities.supportsRollback && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRollback(liveDeployment.id)}
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Rollback
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCancel(liveDeployment.id)}
              >
                <XCircle className="w-3 h-3 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <Rocket className="w-8 h-8 mx-auto text-text-muted mb-2" />
            <p className="text-sm text-text-muted">No active deployment</p>
          </div>
        )}
      </div>

      {/* Deployment Comments */}
      {liveDeployment && (
        <div className="p-3 border-b">
          <DeploymentComments deploymentId={liveDeployment.id} />
        </div>
      )}

      {/* Deploy Button */}
      <div className="p-3 border-b">
        <Button
          onClick={handleDeploy}
          disabled={deploying || !projectId}
          className="w-full"
        >
          {deploying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Deploying...
            </>
          ) : (
            <>
              <Rocket className="w-4 h-4 mr-2" />
              Deploy Now
            </>
          )}
        </Button>
      </div>

      {/* Deployment History */}
      <div className="flex-1 overflow-auto">
        <div className="p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1">
            <History className="w-3 h-3" />
            History
          </h4>
          {deployments.data && deployments.data.length > 0 ? (
            <div className="space-y-2">
              {deployments.data.map((deployment) => {
                const config = STATUS_CONFIG[deployment.status] ?? STATUS_CONFIG.queued;
                const Icon = config.icon;
                return (
                  <div
                    key={deployment.id}
                    className="flex items-center justify-between p-2 bg-surface-1 rounded text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-4 h-4", config.color, config.spin && "animate-spin")} />
                      <span>{config.label}</span>
                      <span className="text-xs text-text-muted">{deployment.providerType}</span>
                    </div>
                    <span className="text-xs text-text-muted">
                      {new Date(deployment.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-text-muted text-center py-4">
              No deployments yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
