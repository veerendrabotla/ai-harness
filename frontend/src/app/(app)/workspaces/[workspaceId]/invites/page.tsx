"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyableField } from "@/components/ui/copyable-field.js";
import { Copy } from "lucide-react";
import { Field, Input } from "@/components/ui/form";
import { ErrorState, EmptyState } from "@/components/ui/states";

interface InviteLike {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

/** Owner-facing invite management (PRD F-02). */
export default function WorkspaceInvitesPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MEMBER" | "VIEWER">("MEMBER");
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const query = useQuery({
    queryKey: ["invites", workspaceId],
    queryFn: () => apiFetch<InviteLike[]>(`/v1/workspaces/${workspaceId}/invites`),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string }>(`/v1/workspaces/${workspaceId}/invites`, {
        method: "POST",
        json: { email, role },
      }),
    onSuccess: async (data) => {
      setIssued(data.token);
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["invites", workspaceId] });
    },
    onError: setError,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/workspaces/${workspaceId}/invites/${id}`, { method: "DELETE" }),
    onSuccess: async () => qc.invalidateQueries({ queryKey: ["invites", workspaceId] }),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
      <h1 className="text-h1">Invitations</h1>
      <p className="mt-1 text-[12px] text-text-muted">
        Invite teammates by email; share the one-time token with them. Tokens expire in 7 days.
      </p>

      {error ? <div className="mt-4"><ErrorState error={error} /></div> : null}

      <Card className="mt-6 max-w-xl space-y-4">
        <CardHeader>
          <CardTitle>New invite</CardTitle>
        </CardHeader>
        <Field label="Email" htmlFor="inv-email" required>
          <Input id="inv-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </Field>
        <Field label="Role" htmlFor="inv-role" required>
          <select
            id="inv-role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
          >
            <option value="MEMBER">Member — can create tasks and approve</option>
            <option value="VIEWER">Viewer — read-only</option>
          </select>
        </Field>
        <Button
          loading={create.isPending}
          disabled={!email.includes("@")}
          onClick={() => create.mutate()}
          className="gap-2"
        >
          <UserPlus className="h-4 w-4" aria-hidden /> Create invite
        </Button>

        {issued ? (
          <div className="rounded-lg border border-brand/40 bg-brand/5 p-3">
            <p className="mb-1 text-xs font-medium text-brand">One-time token (copy now):</p>
            <CopyableField value={issued} label="Invite token" />
            <p className="mt-2 text-xs text-text-muted">
              Recipient pastes it at{" "}
              <a href="/settings/invites/accept" className="text-brand hover:underline">
                Settings → Invites → Accept
              </a>
            </p>
          </div>
        ) : null}
      </Card>

      <div className="mt-8 space-y-2">
        {query.isLoading ? (
          <Card>Loading…</Card>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState what="No pending invites" why="Created invitations appear here until accepted or expired." />
        ) : (
          (query.data ?? []).map((i) => (
            <Card key={i.id} className="flex items-center justify-between py-3">
              <div className="text-sm">
                <p className="font-medium">{i.email}</p>
                <p className="text-xs text-text-muted">
                  {i.role.toLowerCase()} · expires {new Date(i.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="danger"
                aria-label={`Revoke invite for ${i.email}`}
                onClick={() => remove.mutate(i.id)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </Card>
          ))
        )}
      </div>

      <p className="mt-8 text-sm text-text-muted flex items-center gap-2">
        <Copy className="h-4 w-4" aria-hidden /> Tip: members can accept at Settings → Invites.
      </p>
      </div>
    </AppShell>
  );
}
