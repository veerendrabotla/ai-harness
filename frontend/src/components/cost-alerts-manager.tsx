"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { Plus, Trash2, Bell, BellOff } from "lucide-react";

interface CostAlert {
  id: string;
  thresholdType: string;
  thresholdValue: number;
  period: string;
  enabled: boolean;
  lastTriggered?: string;
  createdAt: string;
}

export function CostAlertsManager({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAlert, setNewAlert] = useState({ thresholdType: "COST", thresholdValue: "", period: "MONTHLY" });
  const [error, setError] = useState("");

  const alertsQuery = useQuery({
    queryKey: ["cost-alerts", workspaceId],
    queryFn: () => apiFetch<CostAlert[]>(`/v1/workspaces/${workspaceId}/cost-alerts`),
  });

  const createMutation = useMutation({
    mutationFn: (data: { thresholdType: string; thresholdValue: number; period: string }) =>
      apiFetch(`/v1/workspaces/${workspaceId}/cost-alerts`, { method: "POST", json: data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cost-alerts", workspaceId] });
      setShowCreateForm(false);
      setNewAlert({ thresholdType: "COST", thresholdValue: "", period: "MONTHLY" });
    },
    onError: (err) => { setError(err instanceof Error ? err.message : String(err)); },
    onSettled: () => {},
  });

  const toggleMutation = useMutation({
    mutationFn: (alert: CostAlert) =>
      apiFetch(`/v1/workspaces/${workspaceId}/cost-alerts/${alert.id}`, {
        method: "PUT", json: { enabled: !alert.enabled },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cost-alerts", workspaceId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (alertId: string) =>
      apiFetch(`/v1/workspaces/${workspaceId}/cost-alerts/${alertId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cost-alerts", workspaceId] });
    },
  });

  const alerts = alertsQuery.data ?? [];
  const creating = createMutation.isPending;

  function handleCreate() {
    if (!newAlert.thresholdValue || Number(newAlert.thresholdValue) <= 0) return;
    setError("");
    createMutation.mutate({ ...newAlert, thresholdValue: Number(newAlert.thresholdValue) });
  }

  function handleToggle(alert: CostAlert) {
    toggleMutation.mutate(alert);
  }

  function handleDelete(alertId: string) {
    deleteMutation.mutate(alertId);
  }

  function fmtVal(type: string, value: number) {
    return type === "COST" ? `$${value.toFixed(2)}` : value.toLocaleString();
  }

  if (alertsQuery.isLoading) return <div className="text-text-muted p-4">Loading alerts...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Cost Alerts</h2>
        <Button size="sm" onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Alert
        </Button>
      </div>

      {showCreateForm && (
        <Card className="p-4 space-y-3">
          <h3 className="font-medium text-text-primary">Create Cost Alert</h3>
          <p className="text-sm text-text-secondary">Get notified when usage exceeds a threshold.</p>
          <div className="space-y-1.5">
            <Label htmlFor="alert-type">Alert Type</Label>
            <select id="alert-type" value={newAlert.thresholdType}
              onChange={(e) => setNewAlert({ ...newAlert, thresholdType: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text-primary">
              <option value="COST">Cost ($)</option>
              <option value="TOKENS">Tokens</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-value">{newAlert.thresholdType === "COST" ? "Cost Threshold ($)" : "Token Threshold"}</Label>
            <Input id="alert-value" type="number" min="0"
              step={newAlert.thresholdType === "COST" ? "0.01" : "1000"}
              value={newAlert.thresholdValue}
              onChange={(e) => setNewAlert({ ...newAlert, thresholdValue: e.target.value })}
              placeholder={newAlert.thresholdType === "COST" ? "10.00" : "100000"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-period">Period</Label>
            <select id="alert-period" value={newAlert.period}
              onChange={(e) => setNewAlert({ ...newAlert, period: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text-primary">
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={creating}>{creating ? "Creating..." : "Create Alert"}</Button>
            <Button variant="ghost" onClick={() => setShowCreateForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {alerts.length === 0 ? (
        <p className="text-text-muted text-sm">No cost alerts configured. Create one to monitor your usage.</p>
      ) : (
        <div className="grid gap-3">
          {alerts.map((alert) => (
            <Card key={alert.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {alert.enabled ? <Bell className="h-4 w-4 text-brand" /> : <BellOff className="h-4 w-4 text-text-muted" />}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{fmtVal(alert.thresholdType, alert.thresholdValue)}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary">{alert.thresholdType}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary">{alert.period}</span>
                    </div>
                    {alert.lastTriggered && (
                      <p className="text-xs text-text-muted mt-1">Last triggered: {new Date(alert.lastTriggered).toLocaleString()}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleToggle(alert)} className="p-1 text-text-secondary hover:text-text-primary">
                    {alert.enabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  </button>
                  <button onClick={() => handleDelete(alert.id)} className="p-1 text-text-secondary hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
