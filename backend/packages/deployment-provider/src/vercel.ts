/**
 * Vercel Deployment Provider.
 * Real API integration with Vercel's hosting platform.
 */
import type {
  DeploymentProvider,
  DeploymentProviderCapabilities,
  DeploymentConfig,
  ProviderDeploymentResult,
  DeploymentStatus,
} from "./types.js";

const VERCEL_API_BASE = "https://api.vercel.com";

interface VercelDeploymentResponse {
  id: string;
  url: string;
  inspectionUrl: string;
  readyState: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
  created: number;
  target?: string;
  alias?: string[];
  regions?: string[];
}

interface VercelErrorResponse {
  error: { code: string; message: string };
}

export class VercelDeploymentProvider implements DeploymentProvider {
  readonly type = "vercel" as const;

  private deployments = new Map<string, ProviderDeploymentResult>();
  private tokenCache = new Map<string, { valid: boolean; verifiedAt: number }>();

  async validateCredentials(credentials: Record<string, string>): Promise<boolean> {
    const token = credentials.vercel_token;
    if (!token) return false;

    // Check cache (5 min TTL)
    const cached = this.tokenCache.get(token);
    if (cached && Date.now() - cached.verifiedAt < 300_000) {
      return cached.valid;
    }

    try {
      const teamId = credentials.vercel_team_id;
      const url = teamId
        ? `${VERCEL_API_BASE}/v2/teams/${teamId}`
        : `${VERCEL_API_BASE}/v2/user`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const valid = response.ok;
      this.tokenCache.set(token, { valid, verifiedAt: Date.now() });
      return valid;
    } catch (err) {
      console.error("[Deploy] Vercel token verification failed:", err);
      this.tokenCache.set(token, { valid: false, verifiedAt: Date.now() });
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
      warnings.push("No framework specified, Vercel will auto-detect");
    }
    if (!config.buildCommand) {
      warnings.push("No build command specified, using framework defaults");
    }
    if (!config.outputDirectory) {
      warnings.push("No output directory specified, using framework defaults");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async deploy(config: DeploymentConfig, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const token = credentials.vercel_token;
    if (!token) throw new Error("Vercel token required");

    const teamId = credentials.vercel_team_id;
    const files = await this.prepareFiles(config);

    const body: Record<string, unknown> = {
      name: config.projectId,
      files,
      projectSettings: {
        framework: config.framework ?? null,
        buildCommand: config.buildCommand ?? null,
        outputDirectory: config.outputDirectory ?? null,
        installCommand: config.installCommand ?? null,
      },
      target: "production",
    };

    if (teamId) body.teamId = teamId;
    if (config.environmentVariables) {
      body.env = Object.entries(config.environmentVariables).map(([key, value]) => ({
        key,
        value,
        type: "encrypted" as const,
      }));
    }

    const url = teamId
      ? `${VERCEL_API_BASE}/v13/deployments?teamId=${teamId}`
      : `${VERCEL_API_BASE}/v13/deployments`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as VercelErrorResponse;
      throw new Error(`Vercel API error: ${error.error?.message ?? response.statusText}`);
    }

    const data = (await response.json()) as VercelDeploymentResponse;

    const result: ProviderDeploymentResult = {
      providerDeploymentId: data.id,
      status: this.mapVercelStatus(data.readyState),
      deploymentUrl: `https://${data.url}`,
      previewUrl: data.inspectionUrl,
      logs: ["Deployment created on Vercel"],
      sourceRevision: config.source.commitSha,
      createdAt: new Date(data.created),
      metadata: {
        vercelId: data.id,
        url: data.url,
        regions: data.regions,
        alias: data.alias,
        target: data.target,
      },
    };

    this.deployments.set(data.id, result);
    return result;
  }

  async getStatus(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const token = credentials.vercel_token;
    if (!token) throw new Error("Vercel token required");

    const teamId = credentials.vercel_team_id;
    const url = teamId
      ? `${VERCEL_API_BASE}/v13/deployments/${deploymentId}?teamId=${teamId}`
      : `${VERCEL_API_BASE}/v13/deployments/${deploymentId}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = (await response.json()) as VercelErrorResponse;
      throw new Error(`Vercel API error: ${error.error?.message ?? response.statusText}`);
    }

    const data = (await response.json()) as VercelDeploymentResponse;

    const result: ProviderDeploymentResult = {
      providerDeploymentId: data.id,
      status: this.mapVercelStatus(data.readyState),
      deploymentUrl: `https://${data.url}`,
      previewUrl: data.inspectionUrl,
      logs: [],
      sourceRevision: undefined,
      createdAt: new Date(data.created),
      metadata: {
        vercelId: data.id,
        url: data.url,
        regions: data.regions,
      },
    };

    this.deployments.set(data.id, result);
    return result;
  }

  async getLogs(deploymentId: string, credentials: Record<string, string>): Promise<string[]> {
    const token = credentials.vercel_token;
    if (!token) throw new Error("Vercel token required");

    const teamId = credentials.vercel_team_id;
    const url = teamId
      ? `${VERCEL_API_BASE}/v2/deployments/${deploymentId}/events?teamId=${teamId}`
      : `${VERCEL_API_BASE}/v2/deployments/${deploymentId}/events`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as { events?: Array<{ created: number; payload?: { info?: string } }> };
    return (data.events ?? []).map((e) => {
      const ts = new Date(e.created).toISOString();
      return `[${ts}] ${e.payload?.info ?? "event"}`;
    });
  }

  async cancel(deploymentId: string, credentials: Record<string, string>): Promise<boolean> {
    const token = credentials.vercel_token;
    if (!token) return false;

    const teamId = credentials.vercel_team_id;
    const url = teamId
      ? `${VERCEL_API_BASE}/v13/deployments/${deploymentId}/cancel?teamId=${teamId}`
      : `${VERCEL_API_BASE}/v13/deployments/${deploymentId}/cancel`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const cached = this.deployments.get(deploymentId);
      if (cached) cached.status = "cancelled";
      return true;
    }
    return false;
  }

  async rollback(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const token = credentials.vercel_token;
    if (!token) throw new Error("Vercel token required");

    const existing = this.deployments.get(deploymentId);
    const teamId = credentials.vercel_team_id;

    // Get the deployment to find its URL alias
    const getUrl = teamId
      ? `${VERCEL_API_BASE}/v13/deployments/${deploymentId}?teamId=${teamId}`
      : `${VERCEL_API_BASE}/v13/deployments/${deploymentId}`;

    const getResponse = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!getResponse.ok) throw new Error("Failed to fetch deployment for rollback");

    const data = (await getResponse.json()) as VercelDeploymentResponse;

    // Promote this deployment to production
    const promoteUrl = teamId
      ? `${VERCEL_API_BASE}/v13/deployments/${deploymentId}/promote?teamId=${teamId}`
      : `${VERCEL_API_BASE}/v13/deployments/${deploymentId}/promote`;

    const response = await fetch(promoteUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = (await response.json()) as VercelErrorResponse;
      throw new Error(`Vercel rollback error: ${error.error?.message ?? response.statusText}`);
    }

    const result: ProviderDeploymentResult = {
      providerDeploymentId: deploymentId,
      status: "ready",
      deploymentUrl: `https://${data.url}`,
      previewUrl: data.inspectionUrl,
      logs: ["Rolled back to this deployment"],
      createdAt: new Date(data.created),
      metadata: {
        ...existing?.metadata,
        rollbackOf: deploymentId,
      },
    };

    this.deployments.set(deploymentId, result);
    return result;
  }

  async destroy(deploymentId: string, credentials: Record<string, string>): Promise<boolean> {
    const token = credentials.vercel_token;
    if (!token) return false;

    const teamId = credentials.vercel_team_id;
    const url = teamId
      ? `${VERCEL_API_BASE}/v13/deployments/${deploymentId}?teamId=${teamId}`
      : `${VERCEL_API_BASE}/v13/deployments/${deploymentId}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      this.deployments.delete(deploymentId);
      return true;
    }
    return false;
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
      maxDeploymentSize: 100 * 1024 * 1024,
      supportedFrameworks: [
        "nextjs", "react", "vue", "angular", "svelte",
        "nuxt", "gatsby", "remix", "astro", "solid",
      ],
    };
  }

  private mapVercelStatus(readyState: string): DeploymentStatus {
    switch (readyState) {
      case "QUEUED": return "queued";
      case "BUILDING": return "building";
      case "READY": return "ready";
      case "ERROR": return "failed";
      case "CANCELED": return "cancelled";
      default: return "deploying";
    }
  }

  private async prepareFiles(config: DeploymentConfig): Promise<Array<{ file: string; data: string; encoding: "utf8" | "base64" }>> {
    const files: Array<{ file: string; data: string; encoding: "utf8" | "base64" }> = [];

    if (config.source.type === "git" && config.source.repository) {
      // For git sources, Vercel pulls directly from the repository.
      // We only need to provide override files if the user specified custom build settings.
      if (config.buildCommand || config.outputDirectory || config.installCommand) {
        const vercelJson: Record<string, unknown> = {};
        if (config.buildCommand) vercelJson.buildCommand = config.buildCommand;
        if (config.outputDirectory) vercelJson.outputDirectory = config.outputDirectory;
        if (config.installCommand) vercelJson.installCommand = config.installCommand;
        if (config.framework) vercelJson.framework = config.framework;
        files.push({ file: "vercel.json", data: JSON.stringify(vercelJson, null, 2), encoding: "utf8" });
      }
    } else if (config.source.type === "upload") {
      // For file uploads, the files are sent via the Vercel Files API
      // (handled by the upload endpoint, not prepareFiles)
    } else if (config.source.type === "url") {
      // For URL sources, Vercel deploys from the URL directly
    }

    return files;
  }
}
