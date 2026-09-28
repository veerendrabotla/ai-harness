"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";

export default function AccountSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/v1/users/me", {
        method: "PATCH",
        json: { displayName, avatarUrl: avatarUrl === "" ? null : avatarUrl },
      }),
    onSuccess: async () => {
      setSaved(true);
      setSaveError(null);
      setTimeout(() => setSaved(false), 2000);
      await qc.invalidateQueries();
      useAuthStore.setState((s) => ({ ...s, user: s.user ? { ...s.user, displayName, avatarUrl: avatarUrl || null } : s.user }));
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : "Failed to save profile"),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <h1 className="text-h1">Account</h1>

        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <Field label="Display name" htmlFor="dn">
              <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Avatar URL" htmlFor="av">
              <Input id="av" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <div className="flex items-center gap-3">
              <Button loading={save.isPending} disabled={!displayName.trim()} onClick={() => save.mutate()}>
                Save profile
              </Button>
              {saved ? <span className="text-xs text-success">Saved ✓</span> : null}
              {saveError ? <span className="text-xs text-danger">{saveError}</span> : null}
            </div>
          </div>
        </Card>

        <Card className="mt-4 max-w-xl">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Status</dt>
              <dd className={user?.status === "ACTIVE" ? "text-success" : ""}>{user?.status}</dd>
            </div>
          </dl>
        </Card>

        <p className="mt-6 text-sm">
          <Link href="/settings/security" className="text-brand hover:text-brand-hover">
            Manage active sessions →
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
