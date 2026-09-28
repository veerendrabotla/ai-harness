/**
 * Railway Deployment Provider.
 * Deploys applications to Railway's infrastructure.
 */
import type {
  DeploymentProvider,
  DeploymentProviderCapabilities,
  DeploymentConfig,
  ProviderDeploymentResult,
  DeploymentStatus,
} from "./types.js";

const RAILWAY_API_BASE = "https://backboard.railway.app/graphql";

interface RailwayDeployResponse {
  data?: {
    deploymentDeploy?: {
      id: string;
      status: string;
      url?: string;
      createdAt: string;
    };
  };
  errors?: Array<{ message: string }>;
}

export class RailwayDeploymentProvider implements DeploymentProvider {
  readonly type = "railway" as const;

  private deployments = new Map<string, ProviderDeploymentResult>();

  async validateCredentials(credentials: Record<string, string>): Promise<boolean> {
    const token = credentials.railway_token;
    if (!token) return false;

    try {
      const response = await fetch(RAILWAY_API_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ me { id email } }" }),
      });
      const data = (await response.json()) as { data?: { me?: unknown } };
      return !!data.data?.me;
    } catch (err) {
      console.error("[Deploy] Railway token verification failed:", err);
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

    if (!config.source.repository) {
      errors.push("Railway requires a git repository");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async deploy(config: DeploymentConfig, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const token = credentials.railway_token;
    if (!token) throw new Error("Railway token required");

    const projectId = credentials.railway_project_id;
    const serviceId = credentials.railway_service_id;

    // Create deployment via GraphQL
    const mutation = `
      mutation deploymentDeploy($input: DeploymentDeployInput!) {
        deploymentDeploy(input: $input) {
          id
          status
          url
          createdAt
        }
      }
    `;

    const variables = {
      input: {
        projectId,
        serviceId,
        source: {
          image: config.framework ? `railway/node:18` : undefined,
        },
        variables: config.environmentVariables
          ? Object.entries(config.environmentVariables).map(([key, value]) => ({
              name: key,
              value,
            }))
          : [],
      },
    };

    const response = await fetch(RAILWAY_API_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const data = (await response.json()) as RailwayDeployResponse;

    if (data.errors?.length) {
      throw new Error(`Railway API error: ${data.errors[0]!.message}`);
    }

    const deploy = data.data?.deploymentDeploy;
    if (!deploy) throw new Error("No deployment returned from Railway");

    const result: ProviderDeploymentResult = {
      providerDeploymentId: deploy.id,
      status: this.mapRailwayStatus(deploy.status),
      deploymentUrl: deploy.url,
      logs: ["Railway deployment created"],
      sourceRevision: config.source.commitSha,
      createdAt: new Date(deploy.createdAt),
      metadata: {
        projectId,
        serviceId,
      },
    };

    this.deployments.set(deploy.id, result);
    return result;
  }

  async getStatus(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    const token = credentials.railway_token;
    if (!token) throw new Error("Railway token required");

    const query = `
      query($id: ID!) {
        deployment(id: $id) {
          id
          status
          url
          createdAt
        }
      }
    `;

    const response = await fetch(RAILWAY_API_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { id: deploymentId } }),
    });

    const data = (await response.json()) as { data?: { deployment?: { id: string; status: string; url?: string; createdAt: string } } };
    const deploy = data.data?.deployment;
    if (!deploy) throw new Error("Deployment not found");

    return {
      providerDeploymentId: deploy.id,
      status: this.mapRailwayStatus(deploy.status),
      deploymentUrl: deploy.url,
      logs: [],
      createdAt: new Date(deploy.createdAt),
      metadata: {},
    };
  }

  async getLogs(deploymentId: string, credentials: Record<string, string>): Promise<string[]> {
    const token = credentials.railway_token;
    if (!token) return [];

    try {
      // Fetch deployment logs via Railway GraphQL API
      const query = `query { deployment(id: "${deploymentId}") { logs { nodes { message createdAt } } } }`;
      const res = await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return [`Failed to fetch logs: ${res.status}`];

      const data = await res.json() as { data?: { deployment?: { logs?: { nodes?: Array<{ message: string; createdAt: string }> } } } };
      const nodes = data.data?.deployment?.logs?.nodes;
      if (!nodes || nodes.length === 0) return ["No logs available"];

      return nodes.map((n) => `[${n.createdAt}] ${n.message}`);
    } catch (err) {
      return [`Error fetching logs: ${(err as Error).message}`];
    }
  }

  async cancel(deploymentId: string, credentials: Record<string, string>): Promise<boolean> {
    const token = credentials.railway_token;
    if (!token) return false;

    const mutation = `
      mutation($id: ID!) {
        deploymentCancel(id: $id)
      }
    `;

    const response = await fetch(RAILWAY_API_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation, variables: { id: deploymentId } }),
    });

    return response.ok;
  }

  async rollback(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult> {
    // Railway rollback = redeploy from the same source
    const existing = this.deployments.get(deploymentId);
    if (!existing) throw new Error("Deployment not found");

    const token = credentials.railway_token;
    if (!token) throw new Error("Railway token required");

    const mutation = `
      mutation {
        deploymentRedeploy(id: "${deploymentId}") {
          id
          status
          url
          createdAt
        }
      }
    `;

    const response = await fetch(RAILWAY_API_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation }),
    });

    const data = (await response.json()) as { data?: { deploymentRedeploy?: { id: string; status: string; url?: string; createdAt: string } } };
    const deploy = data.data?.deploymentRedeploy;

    return {
      providerDeploymentId: deploy?.id ?? deploymentId,
      status: "deploying",
      deploymentUrl: deploy?.url ?? existing.deploymentUrl,
      logs: ["Railway rollback initiated"],
      createdAt: new Date(deploy?.createdAt ?? Date.now()),
      metadata: { rollbackOf: deploymentId },
    };
  }

  async destroy(deploymentId: string, credentials: Record<string, string>): Promise<boolean> {
    const token = credentials.railway_token;
    if (!token) return false;

    const mutation = `
      mutation($id: ID!) {
        deploymentDelete(id: $id)
      }
    `;

    const response = await fetch(RAILWAY_API_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: mutation, variables: { id: deploymentId } }),
    });

    if (response.ok) this.deployments.delete(deploymentId);
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
      maxBuildTime: 3600,
      maxDeploymentSize: 500 * 1024 * 1024,
      supportedFrameworks: [
        "nextjs", "react", "vue", "angular", "svelte",
        "nodejs", "python", "go", "ruby", "rust",
      ],
    };
  }

  private mapRailwayStatus(status: string): DeploymentStatus {
    const s = status.toUpperCase();
    if (s === "SUCCESS") return "ready";
    if (s === "FAILED") return "failed";
    if (s === "BUILDING") return "building";
    if (s === "DEPLOYING") return "deploying";
    if (s === "QUEUED") return "queued";
    return "deploying";
  }
}
