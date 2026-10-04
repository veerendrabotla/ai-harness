"use client";

import { useQuery } from "@tanstack/react-query";
import { Store, Check, Search, Filter } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { AppShell } from "@/components/app-shell";
import { useState } from "react";

interface ModelProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  models: Array<{ id: string; name: string; contextLength: number; inputPrice: number; outputPrice: number }>;
}

export default function ModelMarketplacePage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "available">("all");

  const providers = useQuery({
    queryKey: ["model-providers"],
    queryFn: () => apiFetch<{ providers: ModelProvider[] }>("/v1/models/providers"),
  });

  const allModels = providers.data?.providers.flatMap((p) =>
    p.models.map((m) => ({ ...m, providerName: p.name, providerType: p.id, providerApiType: p.type, enabled: p.enabled })),
  ) ?? [];

  const filtered = allModels
    .filter((m) => {
      if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "enabled" && !m.enabled) return false;
      if (filter === "available" && m.inputPrice === 0) return false;
      return true;
    })
    .sort((a, b) => a.inputPrice - b.inputPrice);

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <Store className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Model Marketplace</h1>
            <p className="mt-1 text-[12px] text-text-muted">Browse and compare available AI models</p>
          </div>
        </div>

        {providers.isError && (
          <div className="mt-4">
            <ErrorState error="Failed to load providers" onRetry={() => providers.refetch()} />
          </div>
        )}

        {providers.isLoading && <Skeleton className="mt-6 h-64" />}

        {providers.data && (
          <>
            <div className="mt-6 flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search models..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface-1 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus-visible:outline-none"
                />
              </div>
              <div className="flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-text-muted" />
                {(["all", "enabled", "available"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2 py-1 text-[11px] rounded ${
                      filter === f ? "bg-brand text-white" : "text-text-muted hover:bg-surface-3"
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((model) => (
                <Card key={`${model.providerType}-${model.id}`} className="p-4 hover:border-border-strong transition-all">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-[13px]">{model.name}</CardTitle>
                    {model.enabled && <Check className="h-3.5 w-3.5 text-success" />}
                  </div>
                  <p className="mt-1 text-[11px] text-text-muted">{model.providerName}</p>
                  <p className="mt-1 text-[11px] text-text-muted">{model.id}</p>
                  <div className="mt-3 flex items-center justify-between text-[11px]">
                    <span className="text-text-muted">
                      ${(model.inputPrice * 1000).toFixed(2)}/1K input
                    </span>
                    <span className="text-text-muted">
                      ${(model.outputPrice * 1000).toFixed(2)}/1K output
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {(model.contextLength / 1000).toFixed(0)}K context
                  </p>
                </Card>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full">
                  <EmptyState
                    what="No models found matching your criteria"
                    why="Try adjusting your search or filter criteria."
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
