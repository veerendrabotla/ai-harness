# AI Harness — Extension Guide

## Overview

AI Harness supports extensions that add new agents, tools, models, execution providers, and deployment providers. Extensions are discovered at runtime through the extension registry.

## Extension Types

| Type | Purpose | Example |
|------|---------|---------|
| `agent` | Add new agent roles | Code review agent |
| `tool` | Add new tools | Custom linter |
| `model` | Add new LLM providers | Custom API |
| `execution` | Add execution environments | Kubernetes |
| `deployment` | Add deployment targets | Custom host |
| `memory` | Add memory backends | Vector database |
| `ui` | Add UI components | Custom dashboard |

## Extension Interface

```typescript
import type { Extension, ExtensionManifest } from "@ai-harness/extension-system";

const myExtension: Extension = {
  manifest: {
    name: "my-extension",
    version: "1.0.0",
    description: "Does something useful",
    author: "developer",
    type: "tool",
    capabilities: ["custom-operation"],
    permissions: ["tool:execute"],
    minPlatformVersion: "0.1.0",
  },

  async activate(context) {
    // Called when extension is activated
    console.log(`Activating in workspace ${context.workspaceId}`);
  },

  async deactivate() {
    // Called when extension is deactivated
  },
};
```

## Tool Extensions

Add new tools that agents can use:

```typescript
import type { ToolExtension } from "@ai-harness/extension-system";

const linterTool: ToolExtension = {
  manifest: {
    name: "custom-linter",
    version: "1.0.0",
    description: "Custom linting tool",
    author: "developer",
    type: "tool",
    capabilities: ["linting"],
    permissions: ["tool:execute", "filesystem:read"],
    minPlatformVersion: "0.1.0",
  },

  async activate(context) { /* ... */ },
  async deactivate() { /* ... */ },

  getToolDefinitions() {
    return [
      {
        name: "lint",
        description: "Run custom linter on file",
        category: "custom",
        riskLevel: "LOW",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to lint" },
          },
          required: ["path"],
        },
      },
    ];
  },

  async executeTool(name, input, context) {
    if (name === "lint") {
      const { path } = input as { path: string };
      // Run linting logic
      return { errors: [], warnings: [] };
    }
    throw new Error(`Unknown tool: ${name}`);
  },
};
```

## Agent Extensions

Add new agent roles:

```typescript
import type { AgentExtension } from "@ai-harness/extension-system";

const securityAgent: AgentExtension = {
  manifest: {
    name: "security-agent",
    version: "1.0.0",
    description: "Security analysis agent",
    author: "developer",
    type: "agent",
    capabilities: ["security-analysis", "vulnerability-detection"],
    permissions: ["filesystem:read", "tool:execute"],
    minPlatformVersion: "0.1.0",
  },

  async activate(context) { /* ... */ },
  async deactivate() { /* ... */ },

  getAgentDefinition() {
    return {
      role: "SECURITY",
      name: "Security Analyst",
      description: "Analyzes code for security vulnerabilities",
      capabilities: ["security-analysis", "vulnerability-detection"],
      allowedTools: ["read_file", "run_command"],
    };
  },

  async executeAgent*(input, context) {
    // Agent logic here
    yield { type: "thinking", data: { message: "Analyzing security..." } };
    // ... more execution
    return { findings: [], score: 100 };
  },
};
```

## Model Extensions

Add new LLM providers:

```typescript
import type { ModelExtension } from "@ai-harness/extension-system";

const customProvider: ModelExtension = {
  manifest: {
    name: "custom-llm",
    version: "1.0.0",
    description: "Custom LLM provider",
    author: "developer",
    type: "model",
    capabilities: ["text-generation"],
    permissions: ["network:outbound"],
    minPlatformVersion: "0.1.0",
  },

  async activate(context) { /* ... */ },
  async deactivate() { /* ... */ },

  getModelProviders() {
    return [
      {
        type: "CUSTOM",
        name: "Custom LLM",
        models: ["model-v1", "model-v2"],
      },
    ];
  },
};
```

## Registering Extensions

### In Code

```typescript
import { InMemoryExtensionRegistry } from "@ai-harness/extension-system";

const registry = new InMemoryExtensionRegistry();
registry.register(linterTool);
registry.register(securityAgent);
registry.register(customProvider);

// Activate all
await registry.activateAll({
  workspaceId: "ws_123",
  userId: "user_456",
  userRole: "MEMBER",
});
```

### Via Configuration

Extensions can be loaded from a configuration file:

```json
{
  "extensions": [
    {
      "name": "custom-linter",
      "version": "1.0.0",
      "type": "tool",
      "enabled": true
    },
    {
      "name": "security-agent",
      "version": "1.0.0",
      "type": "agent",
      "enabled": true
    }
  ]
}
```

## Extension Security

Extensions must declare:
- **Capabilities** — What the extension can do
- **Permissions** — What resources it needs access to
- **Min/Max Platform Version** — Compatibility bounds

The platform evaluates extensions against the permission engine before activation.

## Best Practices

1. **Minimal permissions** — Only request what you need
2. **Error handling** — Gracefully handle failures
3. **Cleanup** — Always implement `deactivate()`
4. **Validation** — Validate all inputs
5. **Logging** — Use the platform logger
6. **Testing** — Write tests for your extension
7. **Documentation** — Document capabilities and usage

## Examples

See `backend/packages/extension-system/src/` for the core implementation.

## Publishing

Extensions are npm packages. To publish:

```bash
# Create package
mkdir my-extension
cd my-extension
npm init -y

# Add dependency
npm install @ai-harness/extension-system

# Implement extension
# ...

# Publish
npm publish
```
