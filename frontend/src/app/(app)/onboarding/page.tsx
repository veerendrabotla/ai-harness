"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { KeyRound, Plus, Boxes, Plug } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ProviderLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner, ErrorState } from "@/components/ui/states";

/** First-time setup (APP_FLOW §4): pick one starting action or skip ahead. */
export default function OnboardingPage() {
  const router = useRouter();
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiFetch<ProviderLike[]>("/v1/providers"),
  });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string; name: string }>>("/v1/workspaces"),
  });

  const hasProvider = (providers.data ?? []).length > 0;
  const hasWorkspace = (workspaces.data ?? []).length > 0;

  if (providers.isError || workspaces.isError) {
    return (
      <AppShell>
        <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <h1 className="text-h1">Set up AI Harness</h1>
        <ErrorState
          error="Failed to load setup data"
          onRetry={() => {
            providers.refetch();
            workspaces.refetch();
          }}
        />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <h1 className="text-h1">Set up AI Harness</h1>
      <p className="mt-1 max-w-xl text-sm text-text-muted">
        Choose one action to get started. You can skip anything and complete it later —
        a workspace is required before creating tasks.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Card>
          <Plug className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="mt-3 text-h3">Connect a provider</h2>
          <p className="mt-1 text-[12px] text-text-muted">
            Bring your own API key. It is encrypted at rest and never shown again.
          </p>
          <p className="mt-2 text-xs text-success">{hasProvider ? "Connected ✓" : "Not connected"}</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link href="/settings/providers">Open providers</Link>
          </Button>
        </Card>

        <Card>
          <Boxes className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="mt-3 text-h3">Create a workspace</h2>
          <p className="mt-1 text-[12px] text-text-muted">
            Group projects, instructions and policies. Required for tasks.
          </p>
          <p className="mt-2 text-xs text-success">{hasWorkspace ? "Created ✓" : "Required"}</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link href="/workspaces/new">New workspace</Link>
          </Button>
        </Card>

        <Card>
          <KeyRound className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="mt-3 text-h3">Pair a Local Bridge</h2>
          <p className="mt-1 text-[12px] text-text-muted">
            Optional. Lets agents work on a project root on your own machine.
          </p>
          <p className="mt-2 text-xs text-text-muted">Optional</p>
          <Button asChild variant="ghost" className="mt-4 gap-2">
            <Link href="/bridges/new">
              <Plus className="h-4 w-4" aria-hidden /> Start pairing
            </Link>
          </Button>
        </Card>
      </div>

      <div className="mt-8 flex items-center justify-between">
        {(providers.isLoading || workspaces.isLoading) && <Spinner label="Checking setup" />}
        <Button
          onClick={() => router.push(hasWorkspace ? "/agent" : "/workspaces/new")}
          disabled={!hasWorkspace}
        >
          Finish and go to agent
        </Button>
        {!hasWorkspace ? (
          <span className="text-xs text-text-muted">Create a workspace to continue</span>
        ) : null}
      </div>

      <p className="mt-6 text-sm text-text-secondary">
        Skip for now?{" "}
        <Link href="/agent" className="text-brand hover:text-brand-hover">
          Go to agent workspace
        </Link>
      </p>
      </div>
    </AppShell>
  );
}
