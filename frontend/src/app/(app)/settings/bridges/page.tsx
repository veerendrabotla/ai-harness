"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyableField } from "@/components/ui/copyable-field.js";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

interface BridgeLike {
  id: string;
  name: string;
  version: string;
  status: string;
  lastSeenAt: string | null;
}

export default function BridgesPage() {
  const query = useQuery({
    queryKey: ["bridges"],
    queryFn: () => apiFetch<BridgeLike[]>("/v1/bridges"),
  });

  const tokenMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ pairingToken: string; expiresInMinutes: number }>("/v1/bridges/pairing-tokens", {
        method: "POST",
        json: {},
      }),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-h1">Local Bridges</h1>
          <Button onClick={() => tokenMutation.mutate()} disabled={tokenMutation.isPending} className="gap-1">
            <Plus className="h-4 w-4" aria-hidden /> Pair new bridge
          </Button>
        </div>

        {tokenMutation.data ? (
          <Card className="mt-6 border-brand/40">
            <p className="text-sm font-medium text-text-primary">Pairing token generated</p>
            <p className="mt-1 text-xs text-text-muted">
              Valid for {tokenMutation.data.expiresInMinutes} minutes. Paste it into your Local Bridge installer.
            </p>
            <CopyableField value={tokenMutation.data.pairingToken} label="Pairing token" />
          </Card>
        ) : null}

        <div className="mt-8 space-y-3">
          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (query.data ?? []).length === 0 ? (
            <EmptyState
              what="No bridges registered"
              why="The Local Bridge lets agents work on project roots on your own machine with strict path confinement."
              action={
                <Button variant="outline" onClick={() => tokenMutation.mutate()} loading={tokenMutation.isPending}>
                  Generate a pairing token
                </Button>
              }
            />
          ) : (
            (query.data ?? []).map((b) => (
              <Card key={b.id} className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{b.name}</p>
                  <p className="text-xs text-text-muted">
                    v{b.version} · {b.lastSeenAt ? `last seen ${new Date(b.lastSeenAt).toLocaleString()}` : "never seen"}
                  </p>
                </div>
                <span className={
                  b.status === "CONNECTED" ? "text-sm font-medium text-success"
                    : b.status === "REVOKED" ? "text-sm font-medium text-danger"
                      : "text-sm font-medium text-warning"
                }>
                  ● {b.status}
                </span>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
