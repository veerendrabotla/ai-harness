"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Check, AlertCircle, Cpu } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { ProviderLike, RouteLike } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  workspaceId: string;
  selectedModel?: string;
  onSelect?: (providerId: string, modelId: string) => void;
  className?: string;
}

interface RouteWithProvider extends RouteLike {
  provider?: ProviderLike;
}

export function ModelSelector({ workspaceId, selectedModel, onSelect, className }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiFetch<ProviderLike[]>("/v1/providers"),
  });

  const routes = useQuery({
    queryKey: ["routes", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => apiFetch<RouteLike[]>(`/v1/workspaces/${workspaceId}/model-routes`),
  });

  const enrichedRoutes: RouteWithProvider[] = (routes.data ?? []).map((r) => ({
    ...r,
    provider: providers.data?.find((p) => p.id === r.providerConnectionId),
  }));

  const activeRoutes = enrichedRoutes.filter((r) => r.active);
  const currentRoute = activeRoutes.find((r) => r.modelIdentifier === selectedModel) ?? activeRoutes[0];

  const handleSelect = useCallback((route: RouteWithProvider) => {
    onSelect?.(route.providerConnectionId, route.modelIdentifier);
    setOpen(false);
  }, [onSelect]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] hover:border-border-strong transition-colors"
        aria-label="Select model"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Cpu className="h-3 w-3 text-text-muted" />
        <span className="text-text-primary font-medium truncate max-w-[160px]">
          {currentRoute?.modelIdentifier ?? "No model"}
        </span>
        {currentRoute?.provider && (
          <span className="text-[11px] text-text-muted">{currentRoute.provider.displayName}</span>
        )}
        <ChevronDown className={cn("h-3 w-3 text-text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-80 rounded-xl border border-border bg-surface-1 shadow-xl overflow-hidden">
            <div className="p-2 border-b border-border">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted px-2">Model Routes</span>
            </div>
            <div role="listbox" aria-label="Available models" className="max-h-60 overflow-y-auto p-1">
              {activeRoutes.length === 0 ? (
                <p className="px-3 py-4 text-center text-[11px] text-text-muted">
                  No model routes configured.{" "}
                  <a href="/settings/routing" className="text-brand hover:underline">Set up routing</a>
                </p>
              ) : (
                activeRoutes.map((route) => (
                  <button
                    key={route.id}
                    type="button"
                    role="option"
                    aria-selected={currentRoute?.id === route.id}
                    onClick={() => handleSelect(route)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                      currentRoute?.id === route.id ? "bg-brand/10" : "hover:bg-surface-2",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-text-primary truncate">{route.modelIdentifier}</span>
                        {route.provider && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">
                            {route.provider.displayName}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-text-muted uppercase">{route.stage}</span>
                    </div>
                    {currentRoute?.id === route.id && <Check className="h-3 w-3 text-brand shrink-0" />}
                    {route.provider?.status !== "ACTIVE" && (
                      <AlertCircle className="h-3 w-3 text-warning shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="p-2 border-t border-border">
              <a href="/settings/routing" className="block text-center text-[11px] text-brand hover:underline">
                Manage routing
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
