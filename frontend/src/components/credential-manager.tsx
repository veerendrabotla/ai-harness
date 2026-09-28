"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";

interface Provider {
  type: string;
  capabilities: {
    supportsPreview: boolean;
    supportsCustomDomains: boolean;
    supportsEnvironmentVariables: boolean;
    supportsRollback: boolean;
    supportsHealthChecks: boolean;
    supportsLogs: boolean;
    maxBuildTime: number;
    maxDeploymentSize: number;
    supportedFrameworks: string[];
  };
}

interface StoredSecret {
  id: string;
  providerType: string;
  name: string;
  metadata: Record<string, string>;
  lastUsedAt: string | null;
  createdAt: string;
}

interface CredentialManagerProps {
  projectId: string;
}

export function CredentialManager({ projectId }: CredentialManagerProps) {
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [credentialName, setCredentialName] = useState("");
  const [credentialValue, setCredentialValue] = useState("");
  const [validateCredentialValue, setValidateCredentialValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ["deployment-providers"],
    queryFn: () => apiFetch<{ providers: Provider[] }>("/v1/deployment-providers"),
  });

  const secretsQuery = useQuery({
    queryKey: ["deployment-secrets", projectId],
    queryFn: () => apiFetch<{ secrets: StoredSecret[] }>(`/v1/projects/${projectId}/deployment-secrets`),
  });

  const addCredentialMutation = useMutation({
    mutationFn: (data: { providerType: string; name: string; value: string }) =>
      apiFetch(`/v1/projects/${projectId}/deployment-secrets`, {
        method: "POST",
        json: { ...data, metadata: {} },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["deployment-secrets", projectId] });
      setSuccess("Credential added successfully");
      setCredentialName("");
      setCredentialValue("");
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to add credential");
    },
    onSettled: () => {
      setIsAdding(false);
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: (secretId: string) =>
      apiFetch(`/v1/projects/${projectId}/deployment-secrets/${secretId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["deployment-secrets", projectId] });
      setSuccess("Credential deleted");
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to delete credential");
    },
  });

  const validateMutation = useMutation({
    mutationFn: ({ providerType, credentialValue }: { providerType: string; credentialValue: string }) =>
      apiFetch<{ valid: boolean }>(`/v1/deployment-providers/${providerType}/validate`, {
        method: "POST",
        json: { credentials: { [`${providerType}_token`]: credentialValue } },
      }),
    onSuccess: (data, variables) => {
      if (data.valid) {
        setSuccess(`${variables.providerType} credentials are valid`);
      } else {
        setError(`${variables.providerType} credentials are invalid`);
      }
    },
    onError: () => {
      setError("Validation failed");
    },
  });

  const providers = providersQuery.data?.providers ?? [];
  const secrets = secretsQuery.data?.secrets ?? [];

  function handleAddCredential() {
    if (!selectedProvider || !credentialName || !credentialValue) {
      setError("All fields are required");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsAdding(true);
    addCredentialMutation.mutate({
      providerType: selectedProvider,
      name: credentialName,
      value: credentialValue,
    });
  }

  function handleDeleteCredential(secretId: string) {
    deleteCredentialMutation.mutate(secretId);
  }

  function handleValidateCredentials(providerType: string, credentialValue: string) {
    if (!credentialValue) return;
    validateMutation.mutate({ providerType, credentialValue });
  }

  function getProviderName(type: string): string {
    const names: Record<string, string> = {
      self_hosted: "Self-Hosted",
      vercel: "Vercel",
      cloudflare: "Cloudflare Pages",
      railway: "Railway",
      netlify: "Netlify",
      render: "Render",
    };
    return names[type] || type;
  }

  function getCredentialFieldName(type: string): string {
    const fields: Record<string, string> = {
      vercel: "vercel_token",
      cloudflare: "cloudflare_api_token",
      railway: "railway_token",
      netlify: "netlify_token",
      render: "render_api_key",
    };
    return fields[type] || "api_token";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Deployment Credentials</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-brand text-white rounded-md hover:bg-brand/90"
        >
          Add Credential
        </button>
      </div>

      {error && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-md text-danger">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-md text-success">
          {success}
          <button onClick={() => setSuccess(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Add Credential Form */}
      {isAdding && (
        <div className="p-4 bg-surface-1 border rounded-md">
          <h3 className="font-medium mb-3">Add New Credential</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Provider</label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="w-full border rounded-md px-3 py-2"
              >
                <option value="">Select provider</option>
                {providers
                  .filter((p) => p.type !== "self_hosted")
                  .map((p) => (
                    <option key={p.type} value={p.type}>
                      {getProviderName(p.type)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
                placeholder="e.g., Production Token"
                className="w-full border rounded-md px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {selectedProvider ? getCredentialFieldName(selectedProvider) : "Value"}
              </label>
              <input
                type="password"
                value={credentialValue}
                onChange={(e) => setCredentialValue(e.target.value)}
                placeholder="Enter credential value"
                className="w-full border rounded-md px-3 py-2"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleAddCredential}
              disabled={!selectedProvider || !credentialName || !credentialValue}
              className="px-4 py-2 bg-success text-white rounded-md hover:bg-success/90 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setIsAdding(false);
                setSelectedProvider("");
                setCredentialName("");
                setCredentialValue("");
              }}
              className="px-4 py-2 bg-surface-3 text-text-primary rounded-md hover:bg-surface-4"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing Credentials */}
      <div className="border rounded-md divide-y">
        {secrets.length === 0 ? (
          <div className="p-4 text-text-muted text-center">
            No credentials configured. Add one to enable deployments.
          </div>
        ) : (
          secrets.map((secret) => (
            <div key={secret.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{secret.name}</div>
                <div className="text-sm text-text-muted">
                  {getProviderName(secret.providerType)} • Added{" "}
                  {new Date(secret.createdAt).toLocaleDateString()}
                  {secret.lastUsedAt &&
                    ` • Last used ${new Date(secret.lastUsedAt).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <input
                  type="password"
                  value={validateCredentialValue}
                  onChange={(e) => setValidateCredentialValue(e.target.value)}
                  placeholder="Enter value to validate"
                  className="px-3 py-1 text-sm border rounded flex-1"
                />
                <button
                  onClick={() => {
                    if (validateCredentialValue) {
                      handleValidateCredentials(secret.providerType, validateCredentialValue);
                    }
                  }}
                  disabled={!validateCredentialValue}
                  className="px-3 py-1 text-sm bg-brand/10 text-brand rounded hover:bg-brand/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={validateCredentialValue ? "Validate credential" : "Enter a credential value to validate"}
                >
                  Validate
                </button>
                <button
                  onClick={() => handleDeleteCredential(secret.id)}
                  className="px-3 py-1 text-sm bg-danger/10 text-danger rounded hover:bg-danger/20"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Provider Capabilities */}
      <div>
        <h3 className="font-medium mb-3">Provider Capabilities</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {providers.map((provider) => (
            <div
              key={provider.type}
              className="p-3 border rounded-md"
            >
              <div className="font-medium">{getProviderName(provider.type)}</div>
              <div className="mt-2 text-xs space-y-1">
                <div className={provider.capabilities.supportsRollback ? "text-success" : "text-text-muted"}>
                  {provider.capabilities.supportsRollback ? "✓" : "✗"} Rollback
                </div>
                <div className={provider.capabilities.supportsLogs ? "text-success" : "text-text-muted"}>
                  {provider.capabilities.supportsLogs ? "✓" : "✗"} Logs
                </div>
                <div className={provider.capabilities.supportsPreview ? "text-success" : "text-text-muted"}>
                  {provider.capabilities.supportsPreview ? "✓" : "✗"} Preview
                </div>
                <div className={provider.capabilities.supportsCustomDomains ? "text-success" : "text-text-muted"}>
                  {provider.capabilities.supportsCustomDomains ? "✓" : "✗"} Custom Domains
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
