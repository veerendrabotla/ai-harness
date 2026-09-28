/**
 * Cloudflare Pages Deployment Provider.
 * Deploys applications to Cloudflare's edge network.
 */
import { randomUUID } from "node:crypto";
import type {
  DeploymentProvider,
  DeploymentProviderCapabilities,
  DeploymentConfig,
  ProviderDeploymentResult,
  DeploymentStatus,
} from "./types.js";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CFDeployResponse {
  success: boolean;
  result?: {
    id: string;
    url: string;
    created_on: string;
    modified_on: string;
    deployment_trigger?: { metadata?: { branch?: string; commit_hash?: string } };
  };
  errors?: Array<{ code: number; message: string }>;
}

export class CloudflareDeploymentProvider implements DeploymentProvider {
  readonly type = "cloudflare" as const;

  private deployments = new Map<string, ProviderDeploymentResult>();

  async validateCredentials(credentials: Record<string, string>): Promise<boolean> {
    const apiToken = credentials.cloudflare_api_token;
    const accountId = credentials.cloudflare_account_id;
    if (!apiToken || !accountId) return false;

    try {
      const response = await fetch(`${CF_API_BASE}/accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      return response.ok;
    } catch (err) {
      console.error("[Deploy] Cloudflare token verification failed:", err);
      return false;
    }
  }

  async prepare(config: DeploymentConfig): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.framework) {
      warnings.push("No framework specified, Cloudflare will use defaults");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async deploy(config: DeploymentConfig, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const apiToken = credentials.cloudflare_api_token;
    const accountId = credentials.cloudflare_account_id;
    if (!apiToken || !accountId) throw new Error("Cloudflare API token and account ID required");

    const projectName = config.projectId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();

    // Create or get project
    const projectUrl = `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}`;

    // Create deployment via direct upload
    const deployUrl = `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`;

    const response = await fetch(deployUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "multipart/form-data",
      },
    });

    // If project doesn't exist, create it first
    if (response.status === 404) {
      await fetch(projectUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectName,
          production_branch: config.source.branch ?? "main",
        }),
      });

      // Retry deployment
      const retryResponse = await fetch(deployUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "multipart/form-data",
        },
      });

      if (!retryResponse.ok) {
        const err = (await retryResponse.json()) as CFDeployResponse;
        throw new Error(`Cloudflare deploy failed: ${err.errors?.[0]?.message ?? retryResponse.statusText}`);
      }

      const data = (await retryResponse.json()) as CFDeployResponse;
      return this.buildResult(config, data, projectName);
    }

    if (!response.ok) {
      const err = (await response.json()) as CFDeployResponse;
      throw new Error(`Cloudflare deploy failed: ${err.errors?.[0]?.message ?? response.statusText}`);
    }

    const data = (await response.json()) as CFDeployResponse;
    return this.buildResult(config, data, projectName);
  }

  async getStatus(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const apiToken = credentials.cloudflare_api_token;
    const accountId = credentials.cloudflare_account_id;
    if (!apiToken || !accountId) throw new Error("Cloudflare credentials required");

    const url = `${CF_API_BASE}/accounts/${accountId}/pages/deployments/${deploymentId}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!response.ok) throw new Error("Failed to get deployment status");

    const data = (await response.json()) as CFDeployResponse;
    const result = data.result;

    return {
      providerDeploymentId: deploymentId,
      status: this.mapCFStatus(result?.deployment_trigger?.metadata?.commit_hash ? "ready" : "deploying"),
      deploymentUrl: result?.url ? `https://${result.url}` : undefined,
      logs: [],
      createdAt: new Date(result?.created_on ?? Date.now()),
      metadata: { projectId: credentials.cloudflare_project_id },
    };
  }

  async getLogs(deploymentId: string, credentials: Record<string, string>): Promise<string[]> {
    const apiToken = credentials.cloudflare_api_token;
    const accountId = credentials.cloudflare_account_id;
    if (!apiToken || !accountId) return [];

    const url = `${CF_API_BASE}/accounts/${accountId}/pages/deployments/${deploymentId}/history/logs`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as { result?: { logs?: Array<{ line: string; timestamp: string }> } };
    return (data.result?.logs ?? []).map((l) => `[${l.timestamp}] ${l.line}`);
  }

  async cancel(_deploymentId: string, _credentials: Record<string, string>): Promise<boolean> {
    // Cloudflare doesn't support deployment cancellation
    return false;
  }

  async rollback(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const apiToken = credentials.cloudflare_api_token;
    const accountId = credentials.cloudflare_account_id;
    const projectName = credentials.cloudflare_project_id;
    if (!apiToken || !accountId || !projectName) throw new Error("Cloudflare credentials required");

    // Rollback = create a new deployment from the same source
    const url = `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deployment_trigger: { metadata: { commit_hash: deploymentId } },
      }),
    });

    if (!response.ok) throw new Error("Cloudflare rollback failed");

    const data = (await response.json()) as CFDeployResponse;
    const result = data.result;

    return {
      providerDeploymentId: result?.id ?? deploymentId,
      status: "ready",
      deploymentUrl: result?.url ? `https://${result.url}` : undefined,
      logs: ["Rolled back via Cloudflare"],
      createdAt: new Date(result?.created_on ?? Date.now()),
      metadata: { rollbackOf: deploymentId },
    };
  }

  async destroy(deploymentId: string, credentials: Record<string, string>): Promise<boolean> {
    const apiToken = credentials.cloudflare_api_token;
    const accountId = credentials.cloudflare_account_id;
    if (!apiToken || !accountId) return false;

    const url = `${CF_API_BASE}/accounts/${accountId}/pages/deployments/${deploymentId}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    return response.ok;
  }

  getCapabilities(): DeploymentProviderCapabilities {
    return {
      supportsPreview: true,
      supportsCustomDomains: true,
      supportsEnvironmentVariables: true,
      supportsRollback: true,
      supportsHealthChecks: true,
      supportsLogs: true,
      maxBuildTime: 1800,
      maxDeploymentSize: 25 * 1024 * 1024, // 25MB for Pages
      supportedFrameworks: [
        "nextjs", "react", "vue", "angular", "svelte",
        "nuxt", "gatsby", "remix", "astro", "hugo", "jekyll",
      ],
    };
  }

  private buildResult(
    config: DeploymentConfig,
    data: CFDeployResponse,
    projectName: string,
  ): ProviderDeploymentResult {
    const result = data.result;
    const deploymentResult: ProviderDeploymentResult = {
      providerDeploymentId: result?.id ?? randomUUID(),
      status: "deploying",
      deploymentUrl: result?.url ? `https://${result.url}` : undefined,
      logs: ["Cloudflare deployment created"],
      sourceRevision: config.source.commitSha,
      createdAt: new Date(result?.created_on ?? Date.now()),
      metadata: {
        projectId: projectName,
        branch: config.source.branch,
      },
    };

    this.deployments.set(deploymentResult.providerDeploymentId, deploymentResult);
    return deploymentResult;
  }

  private mapCFStatus(status: string): DeploymentStatus {
    switch (status) {
      case "ready": return "ready";
      case "failed": return "failed";
      case "cancelled": return "cancelled";
      default: return "deploying";
    }
  }
}
