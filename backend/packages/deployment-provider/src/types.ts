/**
 * Deployment Provider Types.
 * Defines the interface for deployment providers (Vercel, Netlify, Self-hosted, etc.)
 */

export type DeploymentProviderType =
  | "self_hosted"
  | "vercel"
  | "netlify"
  | "cloudflare"
  | "railway"
  | "render";

export type DeploymentStatus =
  | "queued"
  | "preparing"
  | "building"
  | "deploying"
  | "health_checking"
  | "ready"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface DeploymentProviderCapabilities {
  supportsPreview: boolean;
  supportsCustomDomains: boolean;
  supportsEnvironmentVariables: boolean;
  supportsRollback: boolean;
  supportsHealthChecks: boolean;
  supportsLogs: boolean;
  maxBuildTime: number; // seconds
  maxDeploymentSize: number; // bytes
  supportedFrameworks: string[];
}

export interface DeploymentConfig {
  projectId: string;
  userId: string;
  source: {
    type: "git" | "upload" | "url";
    repository?: string;
    branch?: string;
    commitSha?: string;
    path?: string;
  };
  buildCommand?: string;
  outputDirectory?: string;
  installCommand?: string;
  environmentVariables?: Record<string, string>;
  framework?: string;
  nodeVersion?: string;
}

export interface ProviderDeploymentResult {
  providerDeploymentId: string;
  status: DeploymentStatus;
  deploymentUrl?: string;
  previewUrl?: string;
  logs: string[];
  sourceRevision?: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface DeploymentProvider {
  /**
   * Get provider type.
   */
  readonly type: DeploymentProviderType;

  /**
   * Validate credentials for this provider.
   */
  validateCredentials(credentials: Record<string, string>): Promise<boolean>;

  /**
   * Prepare a deployment (validate config, check limits).
   */
  prepare(config: DeploymentConfig): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;

  /**
   * Start a deployment.
   */
  deploy(config: DeploymentConfig, credentials: Record<string, string>): Promise<ProviderDeploymentResult>;

  /**
   * Get deployment status.
   */
  getStatus(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult>;

  /**
   * Get deployment logs.
   */
  getLogs(deploymentId: string, credentials: Record<string, string>): Promise<string[]>;

  /**
   * Cancel a deployment.
   */
  cancel(deploymentId: string, credentials: Record<string, string>): Promise<boolean>;

  /**
   * Rollback to a previous deployment.
   */
  rollback(deploymentId: string, credentials: Record<string, string>): Promise<ProviderDeploymentResult>;

  /**
   * Destroy a deployment.
   */
  destroy(deploymentId: string, credentials: Record<string, string>): Promise<boolean>;

  /**
   * Get provider capabilities.
   */
  getCapabilities(): DeploymentProviderCapabilities;
}

export interface DeploymentProviderRegistry {
  /**
   * Register a deployment provider.
   */
  register(provider: DeploymentProvider): void;

  /**
   * Get a provider by type.
   */
  get(type: DeploymentProviderType): DeploymentProvider | undefined;

  /**
   * Get all registered providers.
   */
  getAll(): DeploymentProvider[];

  /**
   * Get provider types.
   */
  getTypes(): DeploymentProviderType[];
}
