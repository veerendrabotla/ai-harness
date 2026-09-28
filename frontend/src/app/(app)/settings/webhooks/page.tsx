"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Webhook,
  Plus,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Send,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface WebhookSubscription {
  id: string;
  url: string;
  eventTypes: string[];
  secret?: string;
  maxRetries: number;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  lastTriggeredAt?: string;
  deliveryCount: number;
  failureCount: number;
}

interface DeliveryLog {
  id: string;
  event: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastError?: string;
  deliveredAt?: string;
  createdAt: string;
}

const EVENT_TYPES = [
  "task.completed",
  "task.failed",
  "deployment.ready",
  "deployment.failed",
  "approval.requested",
  "approval.decided",
  "member.joined",
  "member.removed",
  "workspace.updated",
];

export default function WebhookSettingsPage() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>(["task.completed", "deployment.ready"]);
  const [newSecret, setNewSecret] = useState("");
  const [newRetries, setNewRetries] = useState(3);
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspaces.data?.[0]?.id ?? "";

  const subscriptions = useQuery({
    queryKey: ["webhook-subscriptions", wsId],
    queryFn: () => apiFetch<WebhookSubscription[]>(`/v1/workspaces/${wsId}/webhook-subscriptions`),
    enabled: Boolean(wsId),
  });

  const deliveryLogs = useQuery({
    queryKey: ["webhook-delivery-logs", selectedWebhook, wsId],
    queryFn: () =>
      apiFetch<DeliveryLog[]>(
        `/v1/workspaces/${wsId}/webhook-subscriptions/${selectedWebhook}/deliveries`,
      ),
    enabled: !!selectedWebhook && Boolean(wsId),
  });

  const eventTypesQuery = useQuery({
    queryKey: ["webhook-event-types"],
    queryFn: () => apiFetch<string[]>("/v1/webhooks/event-types"),
  });

  const eventTypes = eventTypesQuery.data ?? EVENT_TYPES;

  const createMutation = useMutation({
    mutationFn: (data: { url: string; eventTypes: string[]; secret?: string; maxRetries: number }) =>
      apiFetch<WebhookSubscription>(`/v1/workspaces/${wsId}/webhook-subscriptions`, {
        method: "POST",
        json: data,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions"] });
      setNewUrl("");
      setNewSecret("");
      setNewRetries(3);
      setShowAddForm(false);
    },
    onError: (err) => setMutationError(err instanceof Error ? err.message : "Failed to create webhook"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      apiFetch(`/v1/workspaces/${wsId}/webhook-subscriptions/${id}`, {
        method: "PATCH",
        json: { status },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions"] });
    },
    onError: (err) => setMutationError(err instanceof Error ? err.message : "Failed to toggle webhook"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/workspaces/${wsId}/webhook-subscriptions/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions"] });
      setSelectedWebhook(null);
    },
    onError: (err) => setMutationError(err instanceof Error ? err.message : "Failed to delete webhook"),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/workspaces/${wsId}/webhook-subscriptions/${id}/test`, {
        method: "POST",
      }),
    onError: (err) => setMutationError(err instanceof Error ? err.message : "Failed to test webhook"),
  });

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <Webhook className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Webhook Subscriptions</h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Manage webhook endpoints that receive event notifications
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Subscriptions List */}
          <div className="lg:col-span-1 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-text-primary">Subscriptions</h2>
              <Button onClick={() => setShowAddForm(!showAddForm)} size="sm" className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>

            {mutationError && (
              <p className="text-[11px] text-danger">{mutationError}</p>
            )}

            {showAddForm && (
              <Card className="p-4 space-y-3">
                <div>
                  <label className="text-[11px] text-text-muted">Endpoint URL</label>
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="mt-1 w-full px-3 py-2 text-[12px] bg-surface-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Secret</label>
                  <input
                    type="password"
                    value={newSecret}
                    onChange={(e) => setNewSecret(e.target.value)}
                    placeholder="Optional signing secret"
                    className="mt-1 w-full px-3 py-2 text-[12px] bg-surface-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Max Retries: {newRetries}</label>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={newRetries}
                    onChange={(e) => setNewRetries(parseInt(e.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Events</label>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                    {eventTypes.map((event) => (
                      <label key={event} className="flex items-center gap-2 text-[11px] text-text-primary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newEvents.includes(event)}
                          onChange={() => toggleEvent(event)}
                          className="rounded border-border"
                        />
                        {event}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      createMutation.mutate({
                        url: newUrl,
                        eventTypes: newEvents,
                        ...(newSecret && { secret: newSecret }),
                        maxRetries: newRetries,
                      })
                    }
                    disabled={!newUrl || newEvents.length === 0 || createMutation.isPending}
                  >
                    {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
                  </Button>
                </div>
              </Card>
            )}

            {subscriptions.isLoading && <Skeleton className="h-40" />}

            {workspaces.isLoading && !subscriptions.isLoading && <Skeleton className="h-40" />}

            {subscriptions.data?.map((wh) => (
              <div
                key={wh.id}
                onClick={() => setSelectedWebhook(wh.id)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedWebhook === wh.id
                    ? "border-brand bg-brand/5"
                    : "border-border bg-surface-2 hover:bg-surface-3"
                }`}
              >
                <div className="flex items-center justify-between">
                  <code className="text-[11px] font-mono text-text-primary truncate flex-1 mr-2">
                    {wh.url}
                  </code>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMutation.mutate({ id: wh.id, status: wh.status === "ACTIVE" ? "DISABLED" : "ACTIVE" });
                      }}
                      className="p-1"
                    >
                      {wh.status === "ACTIVE" ? (
                        <ToggleRight className="h-4 w-4 text-success" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-text-muted" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm("Delete this webhook?")) deleteMutation.mutate(wh.id);
                      }}
                      className="p-1 text-text-muted hover:text-danger"
                      aria-label={`Delete webhook ${wh.url}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                  <span>{wh.eventTypes.length} events</span>
                  <span>·</span>
                  <span>{wh.deliveryCount} deliveries</span>
                  {wh.failureCount > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-danger">{wh.failureCount} failures</span>
                    </>
                  )}
                </div>
              </div>
            ))}

            {subscriptions.data?.length === 0 && !subscriptions.isLoading && (
              <p className="text-[11px] text-text-muted text-center py-6">No webhooks configured</p>
            )}
          </div>

          {/* Details / Logs Panel */}
          <div className="lg:col-span-2">
            {selectedWebhook ? (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[14px] font-medium text-text-primary">Delivery Logs</h2>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testMutation.mutate(selectedWebhook)}
                      disabled={testMutation.isPending}
                      className="gap-1"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deliveryLogs.refetch()}
                      disabled={deliveryLogs.isFetching}
                      aria-label="Refresh delivery logs"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${deliveryLogs.isFetching ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>

                {deliveryLogs.isLoading && <Skeleton className="h-40" />}

                {deliveryLogs.data && deliveryLogs.data.length > 0 && (
                  <div className="space-y-2">
                    {deliveryLogs.data.map((log) => (
                      <div
                        key={log.id}
                        className={`p-3 rounded-lg border ${
                          log.status === "DELIVERED" ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-mono font-medium ${
                              log.status === "DELIVERED" ? "text-success" : "text-danger"
                            }`}>
                              {log.status}
                            </span>
                            <span className="text-[11px] text-text-primary">{log.event}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-text-muted">
                            <span>attempt {log.attemptCount}/{log.maxAttempts}</span>
                            <span>{new Date(log.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                        {log.lastError && (
                          <pre className="mt-2 text-[11px] font-mono text-text-muted max-h-16 overflow-y-auto">
                            {log.lastError.slice(0, 200)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {deliveryLogs.data?.length === 0 && !deliveryLogs.isLoading && (
                  <p className="text-[11px] text-text-muted text-center py-8">No delivery logs yet</p>
                )}
              </Card>
            ) : (
              <Card className="p-8 flex flex-col items-center justify-center text-center min-h-[300px]">
                <Webhook className="h-10 w-10 text-text-muted/30 mb-3" />
                <p className="text-[13px] text-text-muted">Select a webhook to view delivery logs</p>
                <p className="text-[11px] text-text-muted mt-1">
                  Or click &quot;Add&quot; to create a new subscription
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
