"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ProviderLike, RouteLike, WorkspaceDtoLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

const STAGES = ["PLANNING", "IMPLEMENTATION", "REVIEW"] as const;
type Stage = (typeof STAGES)[number];

interface DraftRoute {
  stage: Stage;
  providerConnectionId: string;
  modelIdentifier: string;
  priority: number;
  active: boolean;
}

export default function RoutingPage() {
  const qc = useQueryClient();
  const [selectedWs, setSelectedWs] = useState<string>("");
  const [drafts, setDrafts] = useState<DraftRoute[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<WorkspaceDtoLike[]>("/v1/workspaces"),
  });
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiFetch<ProviderLike[]>("/v1/providers"),
  });

  const wsId = selectedWs || workspaces.data?.[0]?.id || "";

  const routes = useQuery({
    queryKey: ["routes", wsId],
    enabled: Boolean(wsId),
    queryFn: () => apiFetch<RouteLike[]>(`/v1/workspaces/${wsId}/model-routes`),
  });

  useEffect(() => {
    if (routes.data !== undefined) {
      setDrafts([]);
    }
  }, [routes.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!window.confirm("This will replace all model routes for this workspace. Continue?")) {
        throw new Error("Cancelled");
      }
      return apiFetch(`/v1/workspaces/${wsId}/model-routes`, {
        method: "PUT",
        json: { routes: drafts.filter((d) => d.providerConnectionId && d.modelIdentifier) },
      });
    },
    onSuccess: async () => {
      setSaveError(null);
      await qc.invalidateQueries({ queryKey: ["routes", wsId] });
    },
    onError: (err) => setSaveError(err),
  });

  function addDraft(stage: Stage) {
    setDrafts((d) => [
      ...d,
      { stage, providerConnectionId: "", modelIdentifier: "", priority: d.length * 10 + 10, active: true },
    ]);
  }

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <h1 className="text-h1">Model routing</h1>
        <p className="mt-1 text-[12px] text-text-muted">
          Choose which provider + model handles each agent stage. Manual task overrides always win.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <label htmlFor="ws" className="text-sm text-text-secondary">Workspace</label>
          <select
            id="ws"
            value={wsId}
            onChange={(e) => setSelectedWs(e.target.value)}
            className="h-9 rounded-lg border border-border bg-surface-1 px-2 text-sm"
          >
            {(workspaces.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        {saveError ? (
          <div className="mt-4"><ErrorState error={saveError} /></div>
        ) : null}

        {!wsId ? (
          <div className="mt-8">
            <EmptyState what="No workspace selected" why="Create a workspace first to configure routing." />
          </div>
        ) : routes.isLoading ? (
          <Skeleton className="mt-8" />
        ) : (
          <div className="mt-8 space-y-5">
            {STAGES.map((stage) => {
              const existing = (routes.data ?? []).filter((r) => r.stage === stage);
              const stageDrafts = drafts.filter((d) => d.stage === stage);
              return (
                <Card key={stage}>
                  <CardHeader>
                    <CardTitle>{stage.charAt(0)}{stage.slice(1).toLowerCase()}</CardTitle>
                    <Button size="sm" variant="secondary" onClick={() => addDraft(stage)}>Add route</Button>
                  </CardHeader>

                  {existing.length === 0 && stageDrafts.length === 0 ? (
                    <p className="text-sm text-text-muted">No route configured for this stage.</p>
                  ) : null}

                  <ul className="space-y-2">
                    {existing.map((r) => (
                      <li key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm">
                        <span>
                          <span className="font-medium">{providerName(providers.data ?? [], r.providerConnectionId)}</span>{" "}
                          <code className="ml-2 font-mono text-xs text-info">{r.modelIdentifier}</code>
                          {r.active ? "" : <span className="ml-2 text-xs text-text-muted">(inactive)</span>}
                        </span>
                        <span className="text-xs text-text-muted">priority {r.priority}</span>
                      </li>
                    ))}
                    {stageDrafts.map((d, i) => (
                      <li key={`draft-${stage}-${i}`} className="grid gap-2 rounded-lg border border-brand/50 bg-brand/5 px-3 py-3 sm:grid-cols-[1fr_1fr_auto]">
                        <select
                          aria-label="Provider connection"
                          value={d.providerConnectionId}
                          onChange={(e) =>
                            setDrafts((all) =>
                              all.map((x) => (x === d ? { ...x, providerConnectionId: e.target.value } : x)),
                            )
                          }
                          className="h-9 rounded-lg border border-border bg-surface-1 px-2 text-sm"
                        >
                          <option value="">Provider…</option>
                          {(providers.data ?? []).filter((p) => p.status === "ACTIVE").map((p) => (
                            <option key={p.id} value={p.id}>{p.displayName}</option>
                          ))}
                        </select>
                        <input
                          aria-label="Model identifier"
                          placeholder="e.g. gpt-4o-mini"
                          value={d.modelIdentifier}
                          onChange={(e) =>
                            setDrafts((all) =>
                              all.map((x) => (x === d ? { ...x, modelIdentifier: e.target.value } : x)),
                            )
                          }
                          className="h-9 rounded-lg border border-border bg-surface-1 px-3 font-mono text-xs"
                        />
                        <button
                          type="button"
                          aria-label="Remove draft route"
                          onClick={() => setDrafts((all) => all.filter((x) => x !== d))}
                          className="px-2 text-text-muted hover:text-danger"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}

            {drafts.length > 0 ? (
              <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                Save routing changes
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function providerName(providers: ProviderLike[], id: string): string {
  return providers.find((p) => p.id === id)?.displayName ?? id.slice(0, 8);
}
