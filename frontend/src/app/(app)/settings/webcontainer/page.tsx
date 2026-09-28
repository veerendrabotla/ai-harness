"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const TEMPLATES = [
  { id: "blank", label: "Blank", description: "Empty project" },
  { id: "react", label: "React", description: "React with Vite" },
  { id: "nextjs", label: "Next.js", description: "Next.js starter" },
  { id: "express", label: "Express", description: "Express API server" },
  { id: "fastify", label: "Fastify", description: "Fastify API server" },
];

interface WebContainerConfig {
  apiKey: string;
  defaultTemplate: string;
  autoStart: boolean;
  maxSessions: number;
}

export default function WebContainerSettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [defaultTemplate, setDefaultTemplate] = useState("blank");
  const [autoStart, setAutoStart] = useState(false);
  const [maxSessions, setMaxSessions] = useState(5);
  const [saved, setSaved] = useState(false);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspaces.data?.[0]?.id ?? "";

  const settingsQuery = useQuery({
    queryKey: ["webcontainer-settings", wsId],
    queryFn: () => apiFetch<{ settings: WebContainerConfig }>(`/v1/workspaces/${wsId}/settings/webcontainer`),
    enabled: Boolean(wsId),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      const s = settingsQuery.data.settings;
      setApiKey(s.apiKey ?? "");
      setDefaultTemplate(s.defaultTemplate ?? "blank");
      setAutoStart(s.autoStart ?? false);
      setMaxSessions(s.maxSessions ?? 5);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => apiFetch(`/v1/workspaces/${wsId}/settings/webcontainer`, {
      method: "PUT",
      json: { apiKey, defaultTemplate, autoStart, maxSessions } satisfies WebContainerConfig,
    }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-h1">WebContainer</h1>
        </div>

        <p className="mt-2 text-sm text-text-muted max-w-xl">
          Configure WebContainer for running code directly in the browser using StackBlitz&apos;s runtime.
        </p>

        <div className="mt-8 space-y-6 max-w-xl">
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">StackBlitz API Key</h2>
            <p className="text-xs text-text-muted">
              Required for WebContainer Pro features. Get your API key from{' '}
              <a href="https://stackblitz.com" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                StackBlitz
              </a>.
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm font-mono"
              aria-label="StackBlitz API key"
            />
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Default Template</h2>
            <p className="text-xs text-text-muted">
              Template to use when creating new WebContainer sessions.
            </p>
            <select
              value={defaultTemplate}
              onChange={(e) => setDefaultTemplate(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
              aria-label="Default template"
            >
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label} — {t.description}</option>
              ))}
            </select>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Auto-start</h2>
            <p className="text-xs text-text-muted">
              Automatically start a WebContainer when a session is opened.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => setAutoStart(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-sm text-text-primary">Enable auto-start</span>
            </label>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Max Sessions</h2>
            <p className="text-xs text-text-muted">
              Maximum number of concurrent WebContainer sessions per workspace.
            </p>
            <input
              type="number"
              min={1}
              max={20}
              value={maxSessions}
              onChange={(e) => setMaxSessions(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
              className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
              aria-label="Max sessions"
            />
          </Card>

          <div className="flex items-center gap-3">
            <Button
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Save className="h-4 w-4" aria-hidden /> Save
            </Button>
            {saved && (
              <span className="text-sm text-success">Saved</span>
            )}
            {saveMutation.isError && (
              <span className="text-sm text-danger">Failed to save</span>
            )}
          </div>
        </div>

        <Link href="/settings" className="mt-8 inline-block text-sm text-brand hover:text-brand-hover">
          ← Back to settings
        </Link>
      </div>
    </AppShell>
  );
}
