"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Activity } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { ProviderLike } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, SecretInput } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

const PROVIDER_TYPES = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENAI_COMPATIBLE", "OLLAMA"] as const;
const BASE_URL_PROVIDERS = ["OPENAI_COMPATIBLE", "OLLAMA"] as const;
const NO_KEY_PROVIDERS = ["OLLAMA"] as const;

export default function ProvidersPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [providerType, setProviderType] = useState<(typeof PROVIDER_TYPES)[number]>("ANTHROPIC");
  const [credential, setCredential] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const query = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiFetch<ProviderLike[]>("/v1/providers"),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiFetch("/v1/providers", {
        method: "POST",
        json: {
          providerType,
          displayName,
          credential: credential || undefined,
          metadata: (BASE_URL_PROVIDERS as readonly string[]).includes(providerType) ? { baseUrl } : undefined,
        },
      });
    },
    onSuccess: async () => {
      setShowForm(false);
      setCredential("");
      setDisplayName("");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Connection failed")),
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const testMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/providers/${id}/test`, { method: "POST", json: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["providers"] }),
    onError: (err) => setTestError(err instanceof ApiError ? err.message : "Test failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/providers/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["providers"] }),
    onError: (err) => setDeleteError(err instanceof ApiError ? err.message : "Delete failed"),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-h1">Model providers</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push("/settings/providers/health")}>
              <Activity className="h-3.5 w-3.5" aria-hidden />
              Health
            </Button>
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus className="h-4 w-4" aria-hidden /> Connect provider
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[12px] text-text-muted">
          Keys are encrypted with AES-256-GCM at rest and are never returned after saving.
        </p>

        {showForm ? (
          <Card className="mt-6 max-w-xl space-y-4">
            {formError ? <ErrorState error={formError} /> : null}
            <Field label="Provider type" htmlFor="ptype" required>
              <select
                id="ptype"
                value={providerType}
                onChange={(e) => setProviderType(e.target.value as typeof providerType)}
                className="h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm"
              >
                {PROVIDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "OPENAI_COMPATIBLE" ? "OpenAI-compatible endpoint (vLLM/LM Studio)" : t === "OLLAMA" ? "Ollama (local)" : t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Display name" htmlFor="dname" required>
              <Input id="dname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. My Anthropic key" />
            </Field>
            {(BASE_URL_PROVIDERS as readonly string[]).includes(providerType) ? (
              <Field label="Base URL" htmlFor="burl" required>
                <Input id="burl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={providerType === "OLLAMA" ? "http://localhost:11434" : "http://localhost:11434/v1"} />
              </Field>
            ) : null}
            <Field label="API key" htmlFor="cred" required={!(NO_KEY_PROVIDERS as readonly string[]).includes(providerType)}>
              <SecretInput id="cred" value={credential} onChange={(e) => setCredential(e.target.value)} autoComplete="off" disabled={(NO_KEY_PROVIDERS as readonly string[]).includes(providerType)} placeholder={(NO_KEY_PROVIDERS as readonly string[]).includes(providerType) ? "Not required" : undefined} />
            </Field>
            <div className="flex gap-2">
              <Button
                loading={createMutation.isPending}
                disabled={
                  !displayName ||
                  (!(NO_KEY_PROVIDERS as readonly string[]).includes(providerType) && !credential) ||
                  ((BASE_URL_PROVIDERS as readonly string[]).includes(providerType) && !baseUrl)
                }
                onClick={() => createMutation.mutate()}
              >
                Save & test connection
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
              what="No provider connections"
              why="Connect at least one provider to run planning and implementation models."
            />
          ) : (
            (query.data ?? []).map((p) => (
              <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{p.displayName}</p>
                  <p className="text-xs text-text-muted">
                    {p.providerType} · added {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {(deleteError || testError) && (
                    <ErrorState error={deleteError || testError} />
                  )}
                  <span className={p.status === "ACTIVE" ? "text-xs font-medium text-success" : "text-xs font-medium text-danger"}>
                    {p.status === "ACTIVE" ? "● Active" : p.status === "ERROR" ? "● Error" : "● Disabled"}
                  </span>
                  <Button size="sm" variant="secondary" loading={testMutation.isPending && testMutation.variables === p.id} onClick={() => testMutation.mutate(p.id)}>
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Remove ${p.displayName}`}
                    loading={deleteMutation.isPending && deleteMutation.variables === p.id}
                    onClick={() => { if (window.confirm(`Remove ${p.displayName}?`)) deleteMutation.mutate(p.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>

        <p className="mt-8 text-sm text-text-muted">
          Next: configure which model handles each stage in{" "}
          <button type="button" className="text-brand hover:underline" onClick={() => router.push("/settings/routing")}>
            Routing
          </button>
          .
        </p>
      </div>
    </AppShell>
  );
}
