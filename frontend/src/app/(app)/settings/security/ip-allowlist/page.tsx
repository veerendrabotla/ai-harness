"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Plus, Trash2, Loader2, Check, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface IPAllowlistConfig {
  allowedIPs: string[];
  enabled: boolean;
}

export default function IPAllowlistPage() {
  const queryClient = useQueryClient();
  const [newIP, setNewIP] = useState("");
  const [newCIDR, setNewCIDR] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspaces.data?.[0]?.id ?? "";

  const config = useQuery({
    queryKey: ["ip-allowlist", wsId],
    queryFn: () => apiFetch<IPAllowlistConfig>(`/v1/workspaces/${wsId}/ip-allowlist`),
    enabled: Boolean(wsId),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { allowedIPs: string[]; enabled: boolean }) =>
      apiFetch(`/v1/workspaces/${wsId}/ip-allowlist`, {
        method: "PUT",
        json: data,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ip-allowlist"] });
      setMessage({ type: "success", text: "IP allowlist updated" });
      setTimeout(() => setMessage(null), 2000);
    },
    onError: () => {
      setMessage({ type: "error", text: "Failed to update IP allowlist" });
    },
  });

  const handleAddIP = () => {
    if (!newIP) return;
    const current = config.data?.allowedIPs ?? [];
    if (current.includes(newIP)) {
      setMessage({ type: "error", text: "IP already in list" });
      return;
    }
    updateMutation.mutate({
      allowedIPs: [...current, newIP],
      enabled: config.data?.enabled ?? false,
    });
    setNewIP("");
  };

  const handleAddCIDR = () => {
    if (!newCIDR) return;
    const current = config.data?.allowedIPs ?? [];
    if (current.includes(newCIDR)) {
      setMessage({ type: "error", text: "CIDR already in list" });
      return;
    }
    updateMutation.mutate({
      allowedIPs: [...current, newCIDR],
      enabled: config.data?.enabled ?? false,
    });
    setNewCIDR("");
  };

  const handleRemove = (ip: string) => {
    const current = config.data?.allowedIPs ?? [];
    updateMutation.mutate({
      allowedIPs: current.filter((i) => i !== ip),
      enabled: config.data?.enabled ?? false,
    });
  };

  const handleToggle = (enabled: boolean) => {
    updateMutation.mutate({
      allowedIPs: config.data?.allowedIPs ?? [],
      enabled,
    });
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">IP Allowlist</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Restrict workspace access to specific IP addresses
            </p>
          </div>
        </div>

        {message && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg px-4 py-3 text-[12px] ${
              message.type === "success"
                ? "bg-success/10 text-success border border-success/20"
                : "bg-danger/10 text-danger border border-danger/20"
            }`}
          >
            {message.type === "success" ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}

        <div className="mt-6 space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[14px] text-text-primary">Enable IP Allowlist</CardTitle>
                <p className="mt-1 text-[12px] text-text-muted">
                  When enabled, only listed IPs can access this workspace
                </p>
              </div>
              {config.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={config.data?.enabled ?? false}
                    onChange={(e) => handleToggle(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-surface-3 rounded-full peer-checked:bg-brand transition-colors" />
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-4 transition-transform shadow-sm" />
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <CardTitle className="text-[14px] text-text-primary">Allowed IPs</CardTitle>
            <p className="mt-1 text-[12px] text-text-muted">
              Add individual IPs or CIDR ranges
            </p>

            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                value={newIP}
                onChange={(e) => setNewIP(e.target.value)}
                placeholder="192.168.1.1"
                className="flex-1 px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg font-mono focus:outline-none focus:border-brand"
              />
              <Button
                onClick={handleAddIP}
                disabled={!newIP || updateMutation.isPending}
                className="gap-1.5"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add IP
              </Button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={newCIDR}
                onChange={(e) => setNewCIDR(e.target.value)}
                placeholder="10.0.0.0/8"
                className="flex-1 px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg font-mono focus:outline-none focus:border-brand"
              />
              <Button
                onClick={handleAddCIDR}
                disabled={!newCIDR || updateMutation.isPending}
                variant="secondary"
                className="gap-1.5"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add CIDR
              </Button>
            </div>

            {config.isLoading && <Skeleton className="mt-4 h-32" />}

            {config.data && config.data.allowedIPs.length > 0 && (
              <div className="mt-4 space-y-2">
                {config.data.allowedIPs.map((ip) => (
                  <div
                    key={ip}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2"
                  >
                    <code className="text-[12px] font-mono text-text-primary">{ip}</code>
                    <button
                      onClick={() => handleRemove(ip)}
                      disabled={updateMutation.isPending}
                      className="text-text-muted hover:text-danger transition-colors"
                      aria-label={`Remove ${ip}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {config.data?.allowedIPs.length === 0 && !config.isLoading && (
              <p className="mt-4 text-[11px] text-text-muted text-center py-4">
                No IPs in allowlist. All IPs will be allowed.
              </p>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
