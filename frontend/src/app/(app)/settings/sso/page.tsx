"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Shield, Plus, Trash2, Check, X } from "lucide-react";

interface SsoConfig {
  id: string;
  provider: string;
  enabled: boolean;
  clientId?: string;
  issuerUrl?: string;
  metadataUrl?: string;
  domain?: string;
  createdAt: string;
}

const PROVIDERS = [
  { value: "okta", label: "Okta", description: "Okta Workforce Identity" },
  { value: "azure_ad", label: "Azure AD", description: "Microsoft Entra ID" },
  { value: "google", label: "Google", description: "Google Workspace" },
  { value: "saml", label: "SAML 2.0", description: "Generic SAML provider" },
];

export default function SsoSettingsPage() {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [newConfig, setNewConfig] = useState({
    provider: "okta",
    clientId: "",
    clientSecret: "",
    issuerUrl: "",
    metadataUrl: "",
    domain: "",
  });
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ configId: string; valid: boolean; issues: string[] } | null>(null);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspacesQuery.data?.[0]?.id ?? "";

  const ssoQuery = useQuery({
    queryKey: ["sso-configs", wsId],
    queryFn: () => apiFetch<SsoConfig[]>(`/v1/workspaces/${wsId}/sso`),
    enabled: Boolean(wsId),
  });
  const configs = ssoQuery.data ?? [];

  async function handleAdd() {
    setError("");
    if (!wsId) { setError("No workspace found"); return; }
    try {
      await apiFetch(`/v1/workspaces/${wsId}/sso`, {
        method: "POST",
        json: newConfig,
      });
      setShowAddForm(false);
      setNewConfig({ provider: "okta", clientId: "", clientSecret: "", issuerUrl: "", metadataUrl: "", domain: "" });
      await qc.invalidateQueries({ queryKey: ["sso-configs", wsId] });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggle(config: SsoConfig) {
    if (!wsId) return;
    try {
      await apiFetch(`/v1/workspaces/${wsId}/sso/${config.id}`, {
        method: "PUT",
        json: { enabled: !config.enabled },
      });
      await qc.invalidateQueries({ queryKey: ["sso-configs", wsId] });
    } catch (err) { setActionError(err instanceof Error ? err.message : "Failed to toggle SSO config"); }
  }

  async function handleDelete(configId: string) {
    if (!wsId) return;
    if (!window.confirm("Remove this SSO provider?")) return;
    try {
      await apiFetch(`/v1/workspaces/${wsId}/sso/${configId}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["sso-configs", wsId] });
    } catch (err) { setActionError(err instanceof Error ? err.message : "Failed to delete SSO config"); }
  }

  async function handleTest(configId: string) {
    if (!wsId) return;
    setTesting(configId);
    setTestResult(null);
    try {
      const result = await apiFetch<{ valid: boolean; issues: string[] }>(
        `/v1/workspaces/${wsId}/sso/${configId}/test`
      );
      setTestResult({ configId, ...result });
    } catch (err) {
      setTestResult({ configId, valid: false, issues: [err instanceof Error ? err.message : "Test failed"] });
    } finally {
      setTesting(null);
    }
  }

  function getProviderLabel(provider: string) {
    return PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
  }

  if (ssoQuery.isLoading) return <AppShell><div className="p-6 text-text-muted">Loading...</div></AppShell>;
  if (ssoQuery.isError) return <AppShell><div className="p-6"><ErrorState error={ssoQuery.error} onRetry={() => ssoQuery.refetch()} /></div></AppShell>;

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1 flex items-center gap-2">
              <Shield className="h-5 w-5" /> SSO Configuration
            </h1>
            <p className="mt-1 text-[12px] text-text-muted">
              Configure Single Sign-On for your workspace
            </p>
          </div>
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Provider
          </Button>
        </div>

        {actionError && (
          <div className="mt-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-[12px] text-danger flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-danger hover:text-danger/80 ml-2">✕</button>
          </div>
        )}

        {showAddForm && (
          <Card className="mt-6 p-5 space-y-4">
            <h3 className="font-medium text-text-primary">Add SSO Provider</h3>
            <div className="space-y-1.5">
              <Label htmlFor="sso-provider">Provider</Label>
              <Select id="sso-provider" value={newConfig.provider}
                onChange={(e) => setNewConfig({ ...newConfig, provider: e.target.value })}>
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label} - {p.description}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-client-id">Client ID</Label>
              <Input id="sso-client-id" value={newConfig.clientId}
                onChange={(e) => setNewConfig({ ...newConfig, clientId: e.target.value })}
                placeholder="OAuth client ID" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-client-secret">Client Secret</Label>
              <Input id="sso-client-secret" type="password" value={newConfig.clientSecret}
                onChange={(e) => setNewConfig({ ...newConfig, clientSecret: e.target.value })}
                placeholder="OAuth client secret" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-issuer">Issuer URL</Label>
              <Input id="sso-issuer" value={newConfig.issuerUrl}
                onChange={(e) => setNewConfig({ ...newConfig, issuerUrl: e.target.value })}
                placeholder="https://your-domain.okta.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-metadata">Metadata URL (SAML)</Label>
              <Input id="sso-metadata" value={newConfig.metadataUrl}
                onChange={(e) => setNewConfig({ ...newConfig, metadataUrl: e.target.value })}
                placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-domain">Email Domain</Label>
              <Input id="sso-domain" value={newConfig.domain}
                onChange={(e) => setNewConfig({ ...newConfig, domain: e.target.value })}
                placeholder="example.com" />
            </div>
            {error && <ErrorState error={error} />}
            <div className="flex gap-2">
              <Button onClick={handleAdd}>Add Provider</Button>
              <Button variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </Card>
        )}

        <div className="mt-6 space-y-3">
          {configs.length === 0 ? (
            <EmptyState
              what="No SSO providers configured"
              why="Add a provider to enable Single Sign-On for your workspace."
            />
          ) : (
            configs.map((config) => (
              <Card key={config.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${config.enabled ? "bg-success" : "bg-text-muted"}`} />
                    <div>
                      <span className="font-medium text-text-primary">{getProviderLabel(config.provider)}</span>
                      {config.domain && <span className="ml-2 text-xs text-text-muted">@{config.domain}</span>}
                      {config.issuerUrl && (
                        <p className="text-xs text-text-muted mt-0.5 font-mono truncate max-w-md">{config.issuerUrl}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleTest(config.id)} disabled={testing === config.id}>
                      {testing === config.id ? "Testing..." : "Test"}
                    </Button>
                    <button onClick={() => handleToggle(config)} className="p-1 text-text-secondary hover:text-text-primary" aria-label={config.enabled ? `Disable ${config.provider}` : `Enable ${config.provider}`}>
                      {config.enabled ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button onClick={() => handleDelete(config.id)} className="p-1 text-text-secondary hover:text-danger" aria-label={`Delete ${config.provider}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {testResult?.configId === config.id && (
                  <div className={`mt-3 p-2 rounded text-[12px] ${testResult.valid ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                    {testResult.valid ? "SSO configuration is valid" : (
                      <div>
                        <p>Issues found:</p>
                        <ul className="list-disc list-inside mt-1">
                          {testResult.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
