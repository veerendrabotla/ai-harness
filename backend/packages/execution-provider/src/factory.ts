/**
 * Execution Provider Factory.
 * Creates the appropriate execution provider based on project configuration.
 *
 *  ExecutionProviderFactory
 *           │
 *  ┌────────┼──────────┬──────────────┐
 *  ↓        ↓          ↓              ↓
 * Local   Cloud     Docker       WebContainer
 * Bridge  Sandbox   Sandbox
 */
import type { PrismaClient } from "@prisma/client";
import { SandboxEngine } from "@ai-harness/sandbox-engine";
import { LocalBridgeProvider } from "./local-bridge.js";
import { CloudSandboxProvider } from "./cloud-sandbox.js";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import type { ExecutionProvider, ExecutionProviderFactory, ProviderConfig } from "./types.js";
import type { DockerEngine } from "./docker-sandbox.js";

const sandboxEngine = new SandboxEngine();

let dockerEngineInstance: DockerEngine | null = null;

async function getDockerEngine(): Promise<DockerEngine> {
  if (dockerEngineInstance) return dockerEngineInstance;
  try {
    const { DockerSandboxEngine } = await import("@ai-harness/sandbox-engine");
    dockerEngineInstance = new DockerSandboxEngine() as DockerEngine;
    return dockerEngineInstance;
  } catch (err) {
    console.error("[Execution] Docker engine module not available:", err);
    throw new Error("Docker engine module not available");
  }
}

export class DefaultExecutionProviderFactory implements ExecutionProviderFactory {
  private providers = new Map<string, ExecutionProvider>();

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create an execution provider for a project.
   * Automatically selects the appropriate provider based on project config.
   */
  async create(config: ProviderConfig): Promise<ExecutionProvider> {
    const existing = this.providers.get(config.projectId);
    if (existing && existing.status === "connected") return existing;

    let provider: ExecutionProvider;

    switch (config.type) {
      case "local_bridge": {
        if (!config.bridgeId || !config.rootReference) {
          throw new Error("Local bridge requires bridgeId and rootReference");
        }
        provider = new LocalBridgeProvider(
          `local-${config.projectId}`,
          config.bridgeId,
          config.rootReference,
        );
        break;
      }

      case "cloud_sandbox": {
        const sandboxId = config.sandboxId ?? await this.provisionSandbox(config);
        provider = new CloudSandboxProvider(
          `cloud-${config.projectId}`,
          sandboxId,
          sandboxEngine,
          config.resourceLimits,
        );
        break;
      }

      case "docker": {
        const dockerEngine = await getDockerEngine();
        const available = await (dockerEngine as unknown as { isDockerAvailable: () => Promise<boolean> }).isDockerAvailable();
        if (!available) {
          throw new Error("Docker daemon is not available. Ensure Docker is installed and running.");
        }
        const engine = dockerEngine as unknown as {
          createContainer: (config: {
            name: string;
            image?: string;
            networkMode?: string;
            volumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
            readonlyRootfs?: boolean;
            capDrop?: string[];
            resourceLimits?: ProviderConfig["resourceLimits"];
          }) => Promise<{ id: string; mounts: Array<{ source: string }> }>;
        };
        const container = await engine.createContainer({
          name: config.sandboxName || `project-${config.projectId}`,
          image: config.dockerImage,
          networkMode: config.dockerNetworkMode,
          volumes: config.dockerVolumes,
          readonlyRootfs: config.dockerReadonlyRootfs,
          capDrop: config.dockerCapDrop,
          resourceLimits: config.resourceLimits,
        });
        provider = new DockerSandboxProvider(
          `docker-${config.projectId}`,
          dockerEngine,
          container.id,
          container.mounts[0]?.source || "",
        );
        break;
      }

      case "webcontainer": {
        const apiKey = config.webcontainerApiKey || process.env.WEBCONTAINER_API_KEY;
        if (!apiKey) {
          throw new Error(
            "WebContainer provider requires StackBlitz API credentials. " +
            "Set WEBCONTAINER_API_KEY environment variable or pass webcontainerApiKey in config. " +
            "See: https://webcontainers.io/guides/getting-started"
          );
        }
        const { WebContainerProvider } = await import("./webcontainer-provider.js");
        const wcProvider = new WebContainerProvider(
          `webcontainer-${config.projectId}`,
          {
            apiKey,
            template: config.webcontainerTemplate,
            ttlMs: config.resourceLimits?.maxLifetimeMs,
          },
        );
        await wcProvider.boot();
        provider = wcProvider;
        break;
      }

      default:
        throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
    }

    this.providers.set(config.projectId, provider);
    return provider;
  }

  /**
   * Auto-detect and create the best provider for a project.
   * Priority: Local Bridge > Docker > Cloud Sandbox
   */
  async createForProject(projectId: string): Promise<ExecutionProvider> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { bridge: true },
    });
    if (!project) throw new Error("Project not found");

    if (project.connectionType === "LOCAL_BRIDGE" && project.bridge && project.bridge.status === "CONNECTED") {
      return this.create({
        type: "local_bridge",
        projectId,
        workspaceId: project.workspaceId,
        bridgeId: project.bridgeId!,
        rootReference: project.rootReference,
      });
    }

    try {
      const dockerEngine = await getDockerEngine();
      const available = await (dockerEngine as unknown as { isDockerAvailable: () => Promise<boolean> }).isDockerAvailable();
      if (available) {
        return this.create({
          type: "docker",
          projectId,
          workspaceId: project.workspaceId,
          sandboxName: project.name,
        });
      }
    } catch (err) {
      console.error("[Execution] Docker provider not available:", err);
    }

    return this.create({
      type: "cloud_sandbox",
      projectId,
      workspaceId: project.workspaceId,
      sandboxName: project.name,
    });
  }

  /**
   * Get an existing provider.
   */
  get(projectId: string): ExecutionProvider | undefined {
    return this.providers.get(projectId);
  }

  /**
   * Destroy a provider.
   */
  async destroy(projectId: string): Promise<void> {
    const provider = this.providers.get(projectId);
    if (provider) {
      await provider.destroy();
      this.providers.delete(projectId);
    }
  }

  /**
   * Check which providers are available.
   */
  async getAvailableProviders(): Promise<Record<string, boolean>> {
    let dockerAvailable = false;
    try {
      const dockerEngine = await getDockerEngine();
      dockerAvailable = await (dockerEngine as unknown as { isDockerAvailable: () => Promise<boolean> }).isDockerAvailable();
    } catch (err) {
      console.error("[Execution] Failed to check Docker availability:", err);
    }
    return {
      local_bridge: true,
      cloud_sandbox: true,
      docker: dockerAvailable,
      webcontainer: !!process.env.WEBCONTAINER_API_KEY,
      remote: false,
    };
  }

  private async provisionSandbox(config: ProviderConfig): Promise<string> {
    const sandbox = await sandboxEngine.createSandbox({
      name: config.sandboxName ?? `project-${config.projectId}`,
    });
    return sandbox.id;
  }
}
