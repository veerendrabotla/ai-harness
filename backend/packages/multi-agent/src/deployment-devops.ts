/**
 * DevOps Agent with Deployment Engine Integration.
 * Connects the DevOps agent to the deployment provider system.
 */
import { DevOpsAgent } from "./devops.js";
import type { AgentTask } from "./types.js";
import type {
  DeploymentProviderFactory,
  DeploymentConfig,
  ProviderDeploymentResult,
} from "@ai-harness/deployment-provider";
import type { CredentialManager } from "@ai-harness/deployment-provider";

export interface DeploymentRequest {
  projectId: string;
  userId: string;
  providerType?: string;
  source: {
    type: "git" | "upload" | "url";
    repository?: string;
    branch?: string;
    commitSha?: string;
  };
  buildCommand?: string;
  outputDirectory?: string;
  framework?: string;
  environmentVariables?: Record<string, string>;
}

export interface DeploymentResult {
  success: boolean;
  deployment?: ProviderDeploymentResult;
  error?: string;
}

/**
 * Enhanced DevOps Agent with real deployment capabilities.
 */
export class DeploymentAwareDevOpsAgent extends DevOpsAgent {
  constructor(
    private readonly providerFactory: DeploymentProviderFactory,
    private readonly credentialManager: CredentialManager,
  ) {
    super();
  }

  /**
   * Execute a deployment task.
   */
  override async execute(task: AgentTask): Promise<AgentTask> {
    this.startTask(task);

    try {
      const request = task.input.deploymentRequest as DeploymentRequest | undefined;

      if (request) {
        const result = await this.deploy(request);
        return this.completeTask({
          action: "deploy",
          result,
        });
      }

      // Fall back to base behavior for non-deployment tasks
      return super.execute(task);
    } catch (error) {
      return this.failTask(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Deploy an application.
   */
  async deploy(request: DeploymentRequest): Promise<DeploymentResult> {
    // 1. Get provider
    const selection = await this.providerFactory.getProvider(
      request.projectId,
      request.providerType as "vercel" | "self_hosted" | undefined,
    );

    if (!selection) {
      return {
        success: false,
        error: "No deployment provider available",
      };
    }

    // 2. Validate credentials
    if (selection.credentials.length === 0 && selection.provider.type !== "self_hosted") {
      return {
        success: false,
        error: `No credentials configured for ${selection.provider.type}`,
      };
    }

    // 3. Prepare deployment
    const config: DeploymentConfig = {
      projectId: request.projectId,
      userId: request.userId,
      source: request.source,
      buildCommand: request.buildCommand,
      outputDirectory: request.outputDirectory,
      framework: request.framework,
      environmentVariables: request.environmentVariables,
    };

    const preparation = await selection.provider.prepare(config);
    if (!preparation.valid) {
      return {
        success: false,
        error: `Preparation failed: ${preparation.errors.join(", ")}`,
      };
    }

    // 4. Deploy
    const credentials: Record<string, string> = {};
    for (const cred of selection.credentials) {
      // In production, decrypt the credential value
      credentials[`${cred.providerType}_token`] = cred.encryptedValue;
    }

    const deployment = await selection.provider.deploy(config, credentials);

    return {
      success: deployment.status === "ready",
      deployment,
    };
  }

  /**
   * Get deployment status.
   */
  async getDeploymentStatus(projectId: string, deploymentId: string): Promise<DeploymentResult> {
    const selection = await this.providerFactory.getProvider(projectId);
    if (!selection) {
      return { success: false, error: "No provider available" };
    }

    const credentials: Record<string, string> = {};
    for (const cred of selection.credentials) {
      credentials[`${cred.providerType}_token`] = cred.encryptedValue;
    }

    const status = await selection.provider.getStatus(deploymentId, credentials);
    return { success: true, deployment: status };
  }

  /**
   * Rollback a deployment.
   */
  async rollback(projectId: string, deploymentId: string): Promise<DeploymentResult> {
    const selection = await this.providerFactory.getProvider(projectId);
    if (!selection) {
      return { success: false, error: "No provider available" };
    }

    if (!selection.provider.getCapabilities().supportsRollback) {
      return { success: false, error: "Provider does not support rollback" };
    }

    const credentials: Record<string, string> = {};
    for (const cred of selection.credentials) {
      credentials[`${cred.providerType}_token`] = cred.encryptedValue;
    }

    const rolledBack = await selection.provider.rollback(deploymentId, credentials);
    return { success: true, deployment: rolledBack };
  }

  /**
   * Cancel a deployment.
   */
  async cancel(projectId: string, deploymentId: string): Promise<boolean> {
    const selection = await this.providerFactory.getProvider(projectId);
    if (!selection) return false;

    const credentials: Record<string, string> = {};
    for (const cred of selection.credentials) {
      credentials[`${cred.providerType}_token`] = cred.encryptedValue;
    }

    return selection.provider.cancel(deploymentId, credentials);
  }

  /**
   * Get deployment logs.
   */
  async getLogs(projectId: string, deploymentId: string): Promise<string[]> {
    const selection = await this.providerFactory.getProvider(projectId);
    if (!selection) return [];

    const credentials: Record<string, string> = {};
    for (const cred of selection.credentials) {
      credentials[`${cred.providerType}_token`] = cred.encryptedValue;
    }

    return selection.provider.getLogs(deploymentId, credentials);
  }
}
