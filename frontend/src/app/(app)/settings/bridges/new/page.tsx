"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyableField } from "@/components/ui/copyable-field.js";
import { ErrorState } from "@/components/ui/states";

interface PairResponse {
  pairingToken: string;
  expiresInMinutes: number;
}

export default function NewBridgePage() {
  const [result, setResult] = useState<PairResponse | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<PairResponse>("/v1/bridges/pairing-tokens", { method: "POST", json: {} }),
    onSuccess: setResult,
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <h1 className="text-h1">Pair a Local Bridge</h1>

        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle>1 · Generate a pairing token</CardTitle>
          </CardHeader>
          <p className="text-sm text-text-muted">
            Run the Local Bridge installer on your machine and paste this token when asked.
            The gateway handshake arrives in the next phase; tokens already expire automatically.
          </p>
          <Button className="mt-4" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Generate token
          </Button>
          {mutation.isError ? (
            <div className="mt-4"><ErrorState error={mutation.error} onRetry={() => mutation.mutate()} /></div>
          ) : null}
        </Card>

        {result ? (
          <Card className="mt-4 max-w-xl border-brand/40">
            <CardHeader>
              <CardTitle>2 · Use it within {result.expiresInMinutes} minutes</CardTitle>
            </CardHeader>
            <CopyableField value={result.pairingToken} label="Pairing token" />
          </Card>
        ) : null}

        <Link href="/settings/bridges" className="mt-8 inline-block text-sm text-brand hover:text-brand-hover">
          ← Back to bridges
        </Link>
      </div>
    </AppShell>
  );
}
