import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  InMemoryDeploymentProviderRegistry,
  SelfHostedDeploymentProvider,
  VercelDeploymentProvider,
  CloudflareDeploymentProvider,
  RailwayDeploymentProvider,
  InMemoryCredentialManager,
  DefaultDeploymentProviderFactory,
} from "@ai-harness/deployment-provider";
import { InMemoryProjectMemoryEngine } from "@ai-harness/project-memory";
import { SupervisorAgent, PlannerAgent, CoderAgent, ReviewerAgent, TesterAgent, DevOpsAgent } from "@ai-harness/multi-agent";
import type { DeploymentConfig } from "@ai-harness/deployment-provider";
import type { AgentTask } from "@ai-harness/multi-agent";

// Mock fetch for API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Full Deployment Chain Integration", () => {
  let registry: InMemoryDeploymentProviderRegistry;
  let credentialManager: InMemoryCredentialManager;
  let factory: DefaultDeploymentProviderFactory;
  let memoryEngine: InMemoryProjectMemoryEngine;
  let supervisor: SupervisorAgent;

  beforeEach(() => {
    registry = new InMemoryDeploymentProviderRegistry();
    credentialManager = new InMemoryCredentialManager();
    factory = new DefaultDeploymentProviderFactory(registry, credentialManager);
    memoryEngine = new InMemoryProjectMemoryEngine();
    supervisor = new SupervisorAgent();

    registry.register(new SelfHostedDeploymentProvider());
    registry.register(new VercelDeploymentProvider());
    registry.register(new CloudflareDeploymentProvider());
    registry.register(new RailwayDeploymentProvider());

    supervisor.registerAgent(new PlannerAgent());
    supervisor.registerAgent(new CoderAgent());
    supervisor.registerAgent(new ReviewerAgent());
    supervisor.registerAgent(new TesterAgent());
    supervisor.registerAgent(new DevOpsAgent());

    mockFetch.mockReset();
  });

  it("should complete full deployment chain with self-hosted", async () => {
    // 1. Store project memory
    await memoryEngine.remember("project-1", {
      projectId: "project-1",
      category: "architecture_decision",
      key: "use-react",
      value: "Use React with TypeScript",
      context: "Frontend framework",
      confidence: 0.9,
      source: "user_input",
      references: [],
    });

    // 2. Get relevant memory
    const insights = await memoryEngine.getRelevant("project-1", "Deploy the application");
    expect(insights.length).toBeGreaterThan(0);

    // 3. Supervisor analyzes task
    const task: AgentTask = {
      id: "task-1",
      role: "supervisor",
      description: "Deploy the application to production",
      input: { goal: "Deploy to production" },
      output: null,
      status: "pending",
      dependencies: [],
    };

    const decision = supervisor.makeDecision(task);
    expect(decision.type).toBe("delegate");

    // 4. Get deployment provider
    const selection = await factory.getProvider("project-1");
    expect(selection).toBeDefined();
    expect(selection?.provider.type).toBe("self_hosted");

    // 5. Prepare deployment
    const config: DeploymentConfig = {
      projectId: "project-1",
      userId: "user-1",
      source: { type: "git", repository: "https://github.com/example/repo" },
      buildCommand: "npm run build",
      outputDirectory: "dist",
      framework: "react",
    };

    const preparation = await selection!.provider.prepare(config);
    expect(preparation.valid).toBe(true);

    // 6. Deploy
    const deployment = await selection!.provider.deploy(config, {});
    expect(deployment.status).toBe("ready");
    expect(deployment.deploymentUrl).toBeDefined();

    // 7. Verify deployment URL
    const status = await selection!.provider.getStatus(deployment.providerDeploymentId, {});
    expect(status.status).toBe("ready");

    // 8. Get logs
    const logs = await selection!.provider.getLogs(deployment.providerDeploymentId, {});
    expect(logs.length).toBeGreaterThan(0);

    // 9. Store deployment memory
    await memoryEngine.remember("project-1", {
      projectId: "project-1",
      category: "deployment_config",
      key: "last-deployment",
      value: `Deployed to ${deployment.deploymentUrl}`,
      context: "Production deployment",
      confidence: 1.0,
      source: "agent_observation",
      references: [deployment.providerDeploymentId],
    });

    // 10. Verify memory stored
    const deploymentMemory = await memoryEngine.query({
      projectId: "project-1",
      category: "deployment_config",
    });
    expect(deploymentMemory.length).toBe(1);
    expect(deploymentMemory[0]!.value).toContain(deployment.deploymentUrl);
  });

  it("should deploy to Vercel with real API calls", async () => {
    // Mock Vercel API responses
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "dpl_123",
        url: "project.vercel.app",
        inspectionUrl: "https://vercel.com/inspect/123",
        readyState: "READY",
        created: Date.now(),
      }),
    });

    // Store Vercel credentials
    await credentialManager.store({
      projectId: "project-1",
      providerType: "vercel",
      name: "Vercel Token",
      encryptedValue: "vercel-token-123",
      metadata: {},
    });

    // Get provider
    const selection = await factory.getProvider("project-1", "vercel");
    expect(selection).toBeDefined();
    expect(selection?.provider.type).toBe("vercel");

    // Deploy
    const config: DeploymentConfig = {
      projectId: "project-1",
      userId: "user-1",
      source: { type: "git", repository: "https://github.com/example/repo" },
      framework: "nextjs",
    };

    const credentials: Record<string, string> = {};
    for (const cred of selection!.credentials) {
      credentials[`${cred.providerType}_token`] = cred.encryptedValue;
    }

    const deployment = await selection!.provider.deploy(config, credentials);
    expect(deployment.status).toBe("ready");
    expect(deployment.deploymentUrl).toContain("vercel.app");
  });

  it("should handle deployment failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { code: "DEPLOYMENT_FAILED", message: "Build failed" },
      }),
    });

    await credentialManager.store({
      projectId: "project-1",
      providerType: "vercel",
      name: "Vercel Token",
      encryptedValue: "vercel-token-123",
      metadata: {},
    });

    const selection = await factory.getProvider("project-1", "vercel");
    const config: DeploymentConfig = {
      projectId: "project-1",
      userId: "user-1",
      source: { type: "git" },
    };

    const credentials: Record<string, string> = {};
    for (const cred of selection!.credentials) {
      credentials[`${cred.providerType}_token`] = cred.encryptedValue;
    }

    await expect(selection!.provider.deploy(config, credentials)).rejects.toThrow("Vercel API error");
  });

  it("should rollback deployment", async () => {
    const provider = registry.get("self_hosted")!;
    const config: DeploymentConfig = {
      projectId: "project-1",
      userId: "user-1",
      source: { type: "git" },
    };

    // Deploy first
    const deployment = await provider.deploy(config, {});
    expect(deployment.status).toBe("ready");

    // Rollback
    const rolledBack = await provider.rollback(deployment.providerDeploymentId, {});
    expect(rolledBack.status).toBe("ready");
    expect(rolledBack.metadata.rollbackOf).toBe(deployment.providerDeploymentId);
  });

  it("should cancel deployment", async () => {
    const provider = registry.get("self_hosted")!;
    const config: DeploymentConfig = {
      projectId: "project-1",
      userId: "user-1",
      source: { type: "git" },
    };

    const deployment = await provider.deploy(config, {});
    const cancelled = await provider.cancel(deployment.providerDeploymentId, {});
    expect(cancelled).toBe(true);

    const status = await provider.getStatus(deployment.providerDeploymentId, {});
    expect(status.status).toBe("cancelled");
  });

  it("should get provider capabilities", () => {
    const providers = registry.getAll();
    expect(providers.length).toBe(4);

    for (const provider of providers) {
      const capabilities = provider.getCapabilities();
      expect(capabilities.supportsRollback).toBe(true);
      expect(capabilities.supportsLogs).toBe(true);
      expect(capabilities.maxBuildTime).toBeGreaterThan(0);
      expect(capabilities.supportedFrameworks.length).toBeGreaterThan(0);
    }
  });

  it("should manage credentials lifecycle", async () => {
    // Store
    const credential = await credentialManager.store({
      projectId: "project-1",
      providerType: "vercel",
      name: "Production Token",
      encryptedValue: "encrypted-value",
      metadata: { environment: "production" },
    });

    expect(credential.id).toBeDefined();

    // Retrieve
    const retrieved = await credentialManager.get(credential.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("Production Token");

    // Get by project and provider
    const vercelCreds = await credentialManager.getByProjectAndProvider("project-1", "vercel");
    expect(vercelCreds.length).toBe(1);

    // Update
    const updated = await credentialManager.update(credential.id, {
      name: "Updated Token",
    });
    expect(updated.name).toBe("Updated Token");

    // Delete
    const deleted = await credentialManager.delete(credential.id);
    expect(deleted).toBe(true);

    const afterDelete = await credentialManager.get(credential.id);
    expect(afterDelete).toBeNull();
  });
});
