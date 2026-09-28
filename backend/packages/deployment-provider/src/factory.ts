/**
 * Deployment Provider Factory.
 * Selects and creates the appropriate deployment provider.
 */
import type {
  DeploymentProvider,
  DeploymentProviderRegistry,
  DeploymentProviderType,
  DeploymentConfig,
} from "./types.js";
import type { CredentialManager, StoredCredential } from "./credentials.js";

export interface ProviderSelection {
  provider: DeploymentProvider;
  credentials: StoredCredential[];
}

export interface DeploymentProviderFactory {
  /**
   * Get the appropriate provider for a deployment.
   */
  getProvider(projectId: string, providerType?: DeploymentProviderType): Promise<ProviderSelection | null>;

  /**
   * Get provider for a config (auto-detect based on framework/source).
   */
  getProviderForConfig(config: DeploymentConfig): Promise<ProviderSelection | null>;
}

export class DefaultDeploymentProviderFactory implements DeploymentProviderFactory {
  constructor(
    private readonly registry: DeploymentProviderRegistry,
    private readonly credentialManager: CredentialManager,
  ) {}

  async getProvider(projectId: string, providerType?: DeploymentProviderType): Promise<ProviderSelection | null> {
    if (providerType) {
      const provider = this.registry.get(providerType);
      if (!provider) return null;

      const credentials = await this.credentialManager.getByProjectAndProvider(projectId, providerType);
      return { provider, credentials };
    }

    // Auto-detect: try providers in priority order
    const providers = this.registry.getAll();
    for (const provider of providers) {
      const credentials = await this.credentialManager.getByProjectAndProvider(projectId, provider.type);
      if (credentials.length > 0) {
        return { provider, credentials };
      }
    }

    // Fallback to self-hosted if available
    const selfHosted = this.registry.get("self_hosted");
    if (selfHosted) {
      return { provider: selfHosted, credentials: [] };
    }

    return null;
  }

  async getProviderForConfig(config: DeploymentConfig): Promise<ProviderSelection | null> {
    // Auto-detect based on framework
    if (config.framework === "nextjs" || config.framework === "react") {
      const vercel = this.registry.get("vercel");
      if (vercel) {
        const credentials = await this.credentialManager.getByProjectAndProvider(
          config.projectId,
          "vercel",
        );
        if (credentials.length > 0) {
          return { provider: vercel, credentials };
        }
      }
    }

    // Fallback to project-based detection
    return this.getProvider(config.projectId);
  }
}
