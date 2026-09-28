"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2, Loader2, Check, Webhook, ToggleLeft, ToggleRight } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface NotificationPrefs {
  email: boolean;
  webhook: boolean;
  slack: boolean;
}

interface WebhookSubscription {
  id: string;
  url: string;
  eventTypes: string[];
  secret?: string;
  maxRetries: number;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  lastTriggeredAt?: string;
  deliveryCount?: number;
  failureCount?: number;
}

const EVENT_TYPES = [
  "task.created",
  "task.completed",
  "task.failed",
  "deployment.queued",
  "deployment.deployed",
  "deployment.failed",
  "plan.approved",
  "plan.rejected",
];

export default function NotificationPreferencesPage() {
  const queryClient = useQueryClient();
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(["task.completed", "deployment.deployed"]);
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [saveMessage, setSaveMessage] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const prefs = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => apiFetch<NotificationPrefs>("/v1/notifications/preferences"),
  });

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspaces.data?.[0]?.id ?? "";

  const webhooks = useQuery({
    queryKey: ["webhook-subscriptions", wsId],
    queryFn: () => apiFetch<WebhookSubscription[]>(`/v1/workspaces/${wsId}/webhook-subscriptions`),
    enabled: Boolean(wsId),
  });

  const updatePrefsMutation = useMutation({
    mutationFn: (data: Partial<NotificationPrefs>) =>
      apiFetch<NotificationPrefs>("/v1/notifications/preferences", {
        method: "PUT",
        json: data,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
      setSaveMessage(true);
      setTimeout(() => setSaveMessage(false), 2000);
    },
  });

  const addWebhookMutation = useMutation({
    mutationFn: (data: { url: string; eventTypes: string[]; secret?: string }) =>
      apiFetch<WebhookSubscription>(`/v1/workspaces/${wsId}/webhook-subscriptions`, {
        method: "POST",
        json: data,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions"] });
      setNewWebhookUrl("");
      setNewWebhookSecret("");
      setShowAddForm(false);
    },
  });

  const toggleWebhookMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      apiFetch(`/v1/workspaces/${wsId}/webhook-subscriptions/${id}`, {
        method: "PATCH",
        json: { status },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions"] });
    },
  });

  const removeWebhookMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/workspaces/${wsId}/webhook-subscriptions/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions"] });
    },
  });

  const toggleEventType = (event: string) => {
    setNewWebhookEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Notifications</h1>
            <p className="mt-1 text-[12px] text-text-muted">Configure how you receive notifications</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <Card className="p-5">
            <CardTitle className="text-[14px] text-text-primary">Notification Channels</CardTitle>
            <p className="mt-1 text-[12px] text-text-muted">
              Choose how you want to be notified about task and deployment events.
            </p>

            {prefs.isLoading && <Skeleton className="mt-4 h-32" />}

            {prefs.data && (
              <div className="mt-4 space-y-3">
                {(["email", "webhook", "slack"] as const).map((channel) => (
                  <label
                    key={channel}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3 cursor-pointer hover:bg-surface-3 transition-colors"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-text-primary capitalize">{channel}</p>
                      <p className="text-[11px] text-text-muted">
                        {channel === "email" && "Receive email notifications"}
                        {channel === "webhook" && "Send notifications to webhook URLs"}
                        {channel === "slack" && "Post notifications to Slack"}
                      </p>
                    </div>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={prefs.data[channel] ?? false}
                        onChange={(e) =>
                          updatePrefsMutation.mutate({ [channel]: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-surface-3 rounded-full peer-checked:bg-brand transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-4 transition-transform shadow-sm" />
                    </div>
                  </label>
                ))}
              </div>
            )}

            {saveMessage && (
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-success">
                <Check className="h-3.5 w-3.5" /> Saved
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[14px] text-text-primary">Webhook Subscriptions</CardTitle>
                <p className="mt-1 text-[12px] text-text-muted">
                  Manage webhook endpoints that receive event notifications.
                </p>
              </div>
              <Button
                onClick={() => setShowAddForm(!showAddForm)}
                className="gap-1.5"
                size="sm"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Webhook
              </Button>
            </div>

            {showAddForm && (
              <div className="mt-4 p-4 bg-surface-2 rounded-lg space-y-3">
                <div>
                  <label className="text-[11px] text-text-muted">Endpoint URL</label>
                  <input
                    type="url"
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="mt-1 w-full px-3 py-2 text-[13px] bg-surface-3 border border-border rounded-lg focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Secret (optional)</label>
                  <input
                    type="password"
                    value={newWebhookSecret}
                    onChange={(e) => setNewWebhookSecret(e.target.value)}
                    placeholder="Signing secret for verification"
                    className="mt-1 w-full px-3 py-2 text-[13px] bg-surface-3 border border-border rounded-lg focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Event Types</label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {EVENT_TYPES.map((event) => (
                      <label
                        key={event}
                        className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newWebhookEvents.includes(event)}
                          onChange={() => toggleEventType(event)}
                          className="rounded border-border"
                        />
                        {event}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setShowAddForm(false)} size="sm">
                    Cancel
                  </Button>
                  <Button
                    onClick={() =>
                      addWebhookMutation.mutate({
                        url: newWebhookUrl,
                        eventTypes: newWebhookEvents,
                        ...(newWebhookSecret && { secret: newWebhookSecret }),
                      })
                    }
                    disabled={!newWebhookUrl || newWebhookEvents.length === 0 || addWebhookMutation.isPending}
                    size="sm"
                  >
                    {addWebhookMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
                  </Button>
                </div>
              </div>
            )}

            {webhooks.isLoading && <Skeleton className="mt-4 h-20" />}

            {webhooks.data && webhooks.data.length > 0 && (
              <div className="space-y-3">
                {webhooks.data.map((wh) => (
                  <div
                    key={wh.id}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0 mr-4">
                      <div className="flex items-center gap-2">
                        <Webhook className="h-3.5 w-3.5 text-text-muted shrink-0" />
                        <code className="text-[12px] font-mono text-text-primary truncate">
                          {wh.url}
                        </code>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-text-muted">
                        <span>{wh.eventTypes.length} events</span>
                        <span>{wh.status}</span>
                        {wh.lastTriggeredAt && (
                          <span>Last: {new Date(wh.lastTriggeredAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          toggleWebhookMutation.mutate({
                            id: wh.id,
                            status: wh.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                          })
                        }
                        className="text-text-muted hover:text-text-primary transition-colors"
                        title={wh.status === "ACTIVE" ? "Disable" : "Enable"}
                      >
                        {wh.status === "ACTIVE" ? (
                          <ToggleRight className="h-4 w-4 text-success" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => removeWebhookMutation.mutate(wh.id)}
                        className="text-text-muted hover:text-danger transition-colors"
                        aria-label={`Remove webhook ${wh.url}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {webhooks.data?.length === 0 && !webhooks.isLoading && (
              <p className="mt-4 text-[11px] text-text-muted text-center py-4">
                No webhook subscriptions configured
              </p>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
