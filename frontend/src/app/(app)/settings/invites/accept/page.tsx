"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";

export default function AcceptInvitePage() {
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ workspaceId: string; role: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Invitation emails link to /settings/invites/accept?token=… — prefill it.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("token");
    if (fromUrl) setToken(fromUrl);
  }, []);

  const accept = useMutation({
    mutationFn: () =>
      apiFetch<{ workspaceId: string; role: string }>("/v1/invites/accept", {
        method: "POST",
        json: { token },
      }),
    onSuccess: (data) => {
      setResult(data);
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: setError,
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <h1 className="text-h1">Accept workspace invite</h1>
        <div className="mt-6 max-w-md space-y-4">
          {error ? <ErrorState error={error} /> : null}
          {result ? (
            <Card className="border-success/40">
              <p className="text-sm text-success">
                Joined workspace as <strong>{result.role.toLowerCase()}</strong>. It now appears in your
                workspaces list.
              </p>
            </Card>
          ) : (
            <>
              <Field label="Invite token" htmlFor="tok" required>
                <Input id="tok" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
              </Field>
              <Button disabled={token.length < 10} loading={accept.isPending} onClick={() => accept.mutate()}>
                Join workspace
              </Button>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
