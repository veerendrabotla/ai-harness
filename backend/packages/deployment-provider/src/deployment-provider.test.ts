import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryDeploymentProviderRegistry } from "./registry.js";
import { SelfHostedDeploymentProvider } from "./self-hosted.js";
import { VercelDeploymentProvider } from "./vercel.js";
import { CloudflareDeploymentProvider } from "./cloudflare.js";
import { RailwayDeploymentProvider } from "./railway.js";
import { InMemoryCredentialManager } from "./credentials.js";
import { DefaultDeploymentProviderFactory } from "./factory.js";
import type { DeploymentConfig } from "./types.js";

// Mock fetch for provider tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Deployment Provider System", () => {
  let registry: InMemoryDeploymentProviderRegistry;
  let credentialManager: InMemoryCredentialManager;
  let selfHosted: SelfHostedDeploymentProvider;
  let vercel: VercelDeploymentProvider;
  let cloudflare: CloudflareDeploymentProvider;
  let railway: RailwayDeploymentProvider;

  beforeEach(() => {
    registry = new InMemoryDeploymentProviderRegistry();
    credentialManager = new InMemoryCredentialManager();
    selfHosted = new SelfHostedDeploymentProvider();
    vercel = new VercelDeploymentProvider();
    cloudflare = new CloudflareDeploymentProvider();
    railway = new RailwayDeploymentProvider();
    registry.register(selfHosted);
    registry.register(vercel);
    registry.register(cloudflare);
    registry.register(railway);
    mockFetch.mockReset();
  });

  describe("Registry", () => {
    it("should register and retrieve providers", () => {
      expect(registry.get("self_hosted")).toBeDefined();
      expect(registry.get("vercel")).toBeDefined();
      expect(registry.get("cloudflare")).toBeDefined();
      expect(registry.get("railway")).toBeDefined();
    });

    it("should get all providers", () => {
      expect(registry.getAll()).toHaveLength(4);
    });
  });

  describe("Self-Hosted Provider", () => {
    it("should deploy application", async () => {
      const config: DeploymentConfig = {
        projectId: "project-1",
        userId: "user-1",
        source: { type: "git" },
      };

      const result = await selfHosted.deploy(config, {});
      expect(result.status).toBe("ready");
      expect(result.deploymentUrl).toBeDefined();
    });

    it("should get capabilities", () => {
      const capabilities = selfHosted.getCapabilities();
      expect(capabilities.supportsRollback).toBe(true);
      expect(capabilities.supportedFrameworks).toContain("react");
    });
  });

  describe("Vercel Provider", () => {
    it("should validate credentials (API call)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const valid = await vercel.validateCredentials({ vercel_token: "a".repeat(24) });
      expect(valid).toBe(true);
    });

    it("should reject invalid credentials", async () => {
      const valid = await vercel.validateCredentials({});
      expect(valid).toBe(false);
    });

    it("should deploy application (API call)", async () => {
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

      const config: DeploymentConfig = {
        projectId: "project-1",
        userId: "user-1",
        source: { type: "git" },
        framework: "nextjs",
      };

      const result = await vercel.deploy(config, { vercel_token: "a".repeat(24) });
      expect(result.status).toBe("ready");
      expect(result.deploymentUrl).toContain("vercel.app");
    });

    it("should get capabilities", () => {
      const capabilities = vercel.getCapabilities();
      expect(capabilities.supportsPreview).toBe(true);
      expect(capabilities.supportedFrameworks).toContain("nextjs");
    });
  });

  describe("Cloudflare Provider", () => {
    it("should validate credentials (API call)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const valid = await cloudflare.validateCredentials({
        cloudflare_api_token: "token123",
        cloudflare_account_id: "account123",
      });
      expect(valid).toBe(true);
    });

    it("should reject missing credentials", async () => {
      const valid = await cloudflare.validateCredentials({});
      expect(valid).toBe(false);
    });

    it("should get capabilities", () => {
      const capabilities = cloudflare.getCapabilities();
      expect(capabilities.supportsPreview).toBe(true);
      expect(capabilities.supportedFrameworks).toContain("nextjs");
    });
  });

  describe("Railway Provider", () => {
    it("should validate credentials (API call)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { me: { id: "user-1" } } }),
      });

      const valid = await railway.validateCredentials({ railway_token: "token123" });
      expect(valid).toBe(true);
    });

    it("should reject invalid credentials", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { me: null } }),
      });

      const valid = await railway.validateCredentials({ railway_token: "invalid" });
      expect(valid).toBe(false);
    });

    it("should get capabilities", () => {
      const capabilities = railway.getCapabilities();
      expect(capabilities.supportsRollback).toBe(true);
      expect(capabilities.supportedFrameworks).toContain("nodejs");
    });
  });

  describe("Credentials Manager", () => {
    it("should store and retrieve credentials", async () => {
      const credential = await credentialManager.store({
        projectId: "project-1",
        providerType: "vercel",
        name: "Vercel Token",
        encryptedValue: "encrypted-value",
        metadata: {},
      });

      expect(credential.id).toBeDefined();
      expect(credential.projectId).toBe("project-1");

      const retrieved = await credentialManager.get(credential.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Vercel Token");
    });

    it("should get credentials by project and provider", async () => {
      await credentialManager.store({
        projectId: "project-1",
        providerType: "vercel",
        name: "Vercel Token",
        encryptedValue: "encrypted-value",
        metadata: {},
      });

      await credentialManager.store({
        projectId: "project-1",
        providerType: "self_hosted",
        name: "Self-Hosted Config",
        encryptedValue: "encrypted-value",
        metadata: {},
      });

      const vercelCreds = await credentialManager.getByProjectAndProvider("project-1", "vercel");
      expect(vercelCreds).toHaveLength(1);
      expect(vercelCreds[0]!.providerType).toBe("vercel");
    });

    it("should delete credentials", async () => {
      const credential = await credentialManager.store({
        projectId: "project-1",
        providerType: "vercel",
        name: "Vercel Token",
        encryptedValue: "encrypted-value",
        metadata: {},
      });

      const deleted = await credentialManager.delete(credential.id);
      expect(deleted).toBe(true);

      const retrieved = await credentialManager.get(credential.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("Provider Factory", () => {
    it("should get provider for project", async () => {
      await credentialManager.store({
        projectId: "project-1",
        providerType: "vercel",
        name: "Vercel Token",
        encryptedValue: "encrypted-value",
        metadata: {},
      });

      const factory = new DefaultDeploymentProviderFactory(registry, credentialManager);
      const selection = await factory.getProvider("project-1");

      expect(selection).toBeDefined();
      expect(selection?.provider.type).toBe("vercel");
    });

    it("should fallback to self-hosted", async () => {
      const factory = new DefaultDeploymentProviderFactory(registry, credentialManager);
      const selection = await factory.getProvider("project-no-creds");

      expect(selection).toBeDefined();
      expect(selection?.provider.type).toBe("self_hosted");
    });
  });
});
