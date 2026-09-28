"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

const TRANSPORT_TYPES = ["STDIO", "SSE", "HTTP"] as const;

interface McpServerLike {
  id: string;
  name: string;
  transportType: string;
  status: string;
  updatedAt: string;
}

export default function McpPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [transportType, setTransportType] = useState<string>("STDIO");
  const [config, setConfig] = useState("");

  const query = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => apiFetch<McpServerLike[]>("/v1/mcp/servers"),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      let parsedConfig: Record<string, unknown> = {};
      if (config.trim()) {
        try {
          parsedConfig = JSON.parse(config);
        } catch {
          throw new Error("Invalid JSON in config");
        }
      }
      return apiFetch("/v1/mcp/servers", {
        method: "POST",
        json: { name, transportType, config: parsedConfig },
      });
    },
    onSuccess: async () => {
      setShowForm(false);
      setName("");
      setConfig("");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    onError: (err) => setFormError(err.message || "Failed to create server"),
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/mcp/servers/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mcp-servers"] }),
    onError: (err) => setDeleteError(err instanceof ApiError ? err.message : "Delete failed"),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-h1">MCP Servers</h1>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden /> Add server
          </Button>
        </div>

      {showForm ? (
        <Card className="mt-6 max-w-xl space-y-4">
          {formError ? <ErrorState error={formError} /> : null}
          <Field label="Server name" htmlFor="mcp-name" required>
            <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. my-file-server" />
          </Field>
          <Field label="Transport type" htmlFor="mcp-transport" required>
            <select
              id="mcp-transport"
              value={transportType}
              onChange={(e) => setTransportType(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
            >
              {TRANSPORT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Config (JSON)" htmlFor="mcp-config">
            <textarea
              id="mcp-config"
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              placeholder='{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"]}'
              className="min-h-[120px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 font-mono text-xs"
            />
          </Field>
          <div className="flex gap-2">
            <Button loading={createMutation.isPending} disabled={!name} onClick={() => createMutation.mutate()}>
              Create server
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <div className="mt-8 space-y-3">
        {query.isLoading ? (
          <Skeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState
            what="No MCP servers registered"
            why="MCP servers extend agents with external capabilities under workspace-level control."
          />
        ) : (
          (query.data ?? []).map((s) => (
            <Card key={s.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-text-muted">{s.transportType}</p>
              </div>
              <div className="flex items-center gap-3">
                {deleteError && (
                  <ErrorState error={deleteError} />
                )}
                <span className={s.status === "ACTIVE" ? "text-sm font-medium text-success" : "text-sm font-medium text-text-muted"}>
                  ● {s.status}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`Remove ${s.name}`}
                  loading={deleteMutation.isPending && deleteMutation.variables === s.id}
                  onClick={() => { if (window.confirm(`Remove ${s.name}?`)) deleteMutation.mutate(s.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Link href="/settings" className="mt-8 inline-block text-sm text-brand hover:text-brand-hover">
        ← Back to settings
      </Link>
      </div>
    </AppShell>
  );
}
