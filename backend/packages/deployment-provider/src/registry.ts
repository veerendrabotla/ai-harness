/**
 * Deployment Provider Registry.
 * Manages registration and retrieval of deployment providers.
 */
import type { DeploymentProvider, DeploymentProviderRegistry, DeploymentProviderType } from "./types.js";

export class InMemoryDeploymentProviderRegistry implements DeploymentProviderRegistry {
  private providers = new Map<DeploymentProviderType, DeploymentProvider>();

  register(provider: DeploymentProvider): void {
    this.providers.set(provider.type, provider);
  }

  get(type: DeploymentProviderType): DeploymentProvider | undefined {
    return this.providers.get(type);
  }

  getAll(): DeploymentProvider[] {
    return Array.from(this.providers.values());
  }

  getTypes(): DeploymentProviderType[] {
    return Array.from(this.providers.keys());
  }
}
