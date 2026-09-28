import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryExtensionRegistry } from "./registry.js";
import type {
  Extension,
  ExtensionManifest,
  ExtensionContext,
  ToolExtension,
  AgentExtension,
} from "./types.js";

function createTestExtension(
  name: string,
  overrides?: Partial<ExtensionManifest>
): Extension {
  return {
    manifest: {
      name,
      version: "1.0.0",
      description: `Test extension ${name}`,
      author: "test",
      type: "tool",
      capabilities: {},
      permissions: {},
      minPlatformVersion: "1.0.0",
      ...overrides,
    },
    activate: async () => {},
    deactivate: async () => {},
  };
}

function createTestToolExtension(name: string): ToolExtension {
  return {
    manifest: {
      name,
      version: "1.0.0",
      description: `Test tool extension ${name}`,
      author: "test",
      type: "tool",
      capabilities: { tools: ["test-tool"] },
      permissions: { filesystem: "read" },
      minPlatformVersion: "1.0.0",
    },
    activate: async () => {},
    deactivate: async () => {},
    getToolDefinitions: () => [
      {
        name: "test-tool",
        description: "A test tool",
        category: "test",
        riskLevel: "LOW",
        inputSchema: {},
      },
    ],
    executeTool: async () => ({ success: true }),
  };
}

function createTestAgentExtension(name: string): AgentExtension {
  return {
    manifest: {
      name,
      version: "1.0.0",
      description: `Test agent extension ${name}`,
      author: "test",
      type: "agent",
      capabilities: { agents: ["test-agent"] },
      permissions: {},
      minPlatformVersion: "1.0.0",
    },
    activate: async () => {},
    deactivate: async () => {},
    getAgentDefinition: () => ({
      role: "tester",
      name: "Test Agent",
      description: "A test agent",
      capabilities: ["testing"],
      allowedTools: ["test-tool"],
    }),
    executeAgent: async function* () {
      yield { type: "test" };
    },
  };
}

const testContext: ExtensionContext = {
  workspaceId: "ws-1",
  projectId: "proj-1",
  userId: "user-1",
  userRole: "ADMIN",
};

describe("InMemoryExtensionRegistry", () => {
  let registry: InMemoryExtensionRegistry;

  beforeEach(() => {
    registry = new InMemoryExtensionRegistry();
  });

  describe("Registration", () => {
    it("should register an extension", () => {
      const ext = createTestExtension("ext-1");
      registry.register(ext);

      expect(registry.isRegistered("ext-1")).toBe(true);
      expect(registry.getExtension("ext-1")).toBe(ext);
    });

    it("should throw on duplicate registration", () => {
      registry.register(createTestExtension("ext-1"));
      expect(() => registry.register(createTestExtension("ext-1"))).toThrow(
        "Extension already registered"
      );
    });

    it("should unregister an extension", () => {
      registry.register(createTestExtension("ext-1"));
      registry.unregister("ext-1");

      expect(registry.isRegistered("ext-1")).toBe(false);
    });

    it("should throw on unregistering active extension", async () => {
      registry.register(createTestExtension("ext-1"));
      await registry.activate("ext-1", testContext);

      expect(() => registry.unregister("ext-1")).toThrow("Cannot unregister active extension");
    });

    it("should list all extensions", () => {
      registry.register(createTestExtension("ext-1"));
      registry.register(createTestExtension("ext-2"));

      expect(registry.listExtensions().length).toBe(2);
    });

    it("should list extensions by type", () => {
      registry.register(createTestExtension("ext-1", { type: "tool" }));
      registry.register(createTestExtension("ext-2", { type: "agent" }));
      registry.register(createTestExtension("ext-3", { type: "tool" }));

      expect(registry.listExtensions("tool").length).toBe(2);
      expect(registry.listExtensions("agent").length).toBe(1);
    });
  });

  describe("Activation", () => {
    it("should activate an extension", async () => {
      registry.register(createTestExtension("ext-1"));
      await registry.activate("ext-1", testContext);

      expect(registry.isActive("ext-1")).toBe(true);
      const state = registry.getState("ext-1");
      expect(state?.lifecycle).toBe("active");
      expect(state?.activatedAt).toBeDefined();
    });

    it("should activate all extensions", async () => {
      registry.register(createTestExtension("ext-1"));
      registry.register(createTestExtension("ext-2"));

      await registry.activateAll(testContext);

      expect(registry.isActive("ext-1")).toBe(true);
      expect(registry.isActive("ext-2")).toBe(true);
    });

    it("should handle activation errors gracefully", async () => {
      const ext = createTestExtension("ext-1");
      ext.activate = async () => {
        throw new Error("Activation failed");
      };
      registry.register(ext);

      try {
        await registry.activate("ext-1", testContext);
      } catch {}

      expect(registry.isActive("ext-1")).toBe(false);
      const state = registry.getState("ext-1");
      expect(state?.lifecycle).toBe("error");
      expect(state?.error).toBe("Activation failed");
    });

    it("should activate dependencies first (topological sort)", async () => {
      const activationOrder: string[] = [];

      const extA = createTestExtension("ext-a");
      extA.activate = async () => {
        activationOrder.push("ext-a");
      };

      const extB = createTestExtension("ext-b", {
        dependencies: [{ name: "ext-a", version: "1.0.0" }],
      });
      extB.activate = async () => {
        activationOrder.push("ext-b");
      };

      registry.register(extA);
      registry.register(extB);
      await registry.activateAll(testContext);

      expect(activationOrder).toEqual(["ext-a", "ext-b"]);
    });
  });

  describe("Deactivation", () => {
    it("should deactivate an extension", async () => {
      registry.register(createTestExtension("ext-1"));
      await registry.activate("ext-1", testContext);
      await registry.deactivate("ext-1");

      expect(registry.isActive("ext-1")).toBe(false);
      const state = registry.getState("ext-1");
      expect(state?.lifecycle).toBe("inactive");
      expect(state?.deactivatedAt).toBeDefined();
    });

    it("should deactivate all extensions", async () => {
      registry.register(createTestExtension("ext-1"));
      registry.register(createTestExtension("ext-2"));
      await registry.activateAll(testContext);

      await registry.deactivateAll();

      expect(registry.isActive("ext-1")).toBe(false);
      expect(registry.isActive("ext-2")).toBe(false);
    });

    it("should deactivate dependents before dependencies", async () => {
      const deactivationOrder: string[] = [];

      const extA = createTestExtension("ext-a");
      extA.deactivate = async () => {
        deactivationOrder.push("ext-a");
      };

      const extB = createTestExtension("ext-b", {
        dependencies: [{ name: "ext-a", version: "1.0.0" }],
      });
      extB.deactivate = async () => {
        deactivationOrder.push("ext-b");
      };

      registry.register(extA);
      registry.register(extB);
      await registry.activateAll(testContext);
      await registry.deactivate("ext-a");

      expect(deactivationOrder).toContain("ext-b");
      expect(deactivationOrder).toContain("ext-a");
      expect(deactivationOrder.indexOf("ext-b")).toBeLessThan(deactivationOrder.indexOf("ext-a"));
    });
  });

  describe("Health Check", () => {
    it("should return healthy for active extension", async () => {
      registry.register(createTestExtension("ext-1"));
      await registry.activate("ext-1", testContext);

      const health = await registry.checkHealth("ext-1");
      expect(health.status).toBe("healthy");
    });

    it("should return unknown for non-existent extension", async () => {
      const health = await registry.checkHealth("nonexistent");
      expect(health.status).toBe("unknown");
    });

    it("should use extension healthCheck if available", async () => {
      const ext = createTestExtension("ext-1");
      ext.healthCheck = async () => ({
        status: "degraded",
        lastChecked: new Date(),
        metrics: { latency: 100 },
      });
      registry.register(ext);
      await registry.activate("ext-1", testContext);

      const health = await registry.checkHealth("ext-1");
      expect(health.status).toBe("degraded");
    });
  });

  describe("Tool Extension", () => {
    it("should register and use tool extension", async () => {
      const ext = createTestToolExtension("tool-ext");
      registry.register(ext);
      await registry.activate("tool-ext", testContext);

      const tools = ext.getToolDefinitions();
      expect(tools.length).toBe(1);
      expect(tools[0]!.name).toBe("test-tool");

      const result = await ext.executeTool("test-tool", {}, testContext);
      expect(result).toEqual({ success: true });
    });
  });

  describe("Agent Extension", () => {
    it("should register and use agent extension", async () => {
      const ext = createTestAgentExtension("agent-ext");
      registry.register(ext);
      await registry.activate("agent-ext", testContext);

      const agent = ext.getAgentDefinition();
      expect(agent.role).toBe("tester");
      expect(agent.name).toBe("Test Agent");

      const results: unknown[] = [];
      for await (const output of ext.executeAgent({}, testContext)) {
        results.push(output);
      }
      expect(results.length).toBe(1);
    });
  });

  describe("Dependency Validation", () => {
    it("should throw on missing required dependency", () => {
      const ext = createTestExtension("ext-1", {
        dependencies: [{ name: "nonexistent", version: "1.0.0" }],
      });

      expect(() => registry.register(ext)).toThrow("Required dependency not found");
    });

    it("should allow optional missing dependencies", () => {
      const ext = createTestExtension("ext-1", {
        dependencies: [{ name: "nonexistent", version: "1.0.0", optional: true }],
      });

      expect(() => registry.register(ext)).not.toThrow();
    });

    it("should fail activation if dependency not active", async () => {
      const ext = createTestExtension("ext-1", {
        dependencies: [{ name: "ext-2", version: "1.0.0" }],
      });
      registry.register(createTestExtension("ext-2"));
      registry.register(ext);

      try {
        await registry.activate("ext-1", testContext);
      } catch {}

      const state = registry.getState("ext-1");
      expect(state?.lifecycle).toBe("error");
    });
  });

  describe("Query Methods", () => {
    it("should list active extensions", async () => {
      registry.register(createTestExtension("ext-1"));
      registry.register(createTestExtension("ext-2"));
      await registry.activate("ext-1", testContext);

      expect(registry.listActive().length).toBe(1);
      expect(registry.listInactive().length).toBe(1);
    });

    it("should list by type", () => {
      registry.register(createTestExtension("ext-1", { type: "tool" }));
      registry.register(createTestExtension("ext-2", { type: "agent" }));

      expect(registry.listByType("tool").length).toBe(1);
      expect(registry.listByType("agent").length).toBe(1);
    });
  });
});
