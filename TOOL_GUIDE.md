# AI Harness — Tool Guide

## Overview

Tools are the execution interface between agents and the outside world. Every tool follows a standardized interface with built-in safety controls.

## Available Tools

### Filesystem Tools
| Tool | Description | Risk |
|------|-------------|------|
| `read_file` | Read file contents | LOW |
| `write_file` | Create or overwrite file | LOW |
| `edit_file` | Apply targeted edits | MEDIUM |
| `delete_file` | Delete a file | HIGH |
| `list_files` | List directory contents | LOW |
| `create_directory` | Create directory | LOW |

### Terminal Tools
| Tool | Description | Risk |
|------|-------------|------|
| `run_command` | Execute shell command | HIGH |

Risk varies by command. Safe commands (npm install, git status) are LOW. Destructive commands (rm -rf, drop database) are CRITICAL.

### Git Tools
| Tool | Description | Risk |
|------|-------------|------|
| `git_status` | Show working tree status | LOW |
| `git_diff` | Show changes | LOW |
| `git_commit` | Create a commit | LOW |
| `git_push` | Push to remote | HIGH |
| `git_checkout` | Switch branch | MEDIUM |

### Browser Tools
| Tool | Description | Risk |
|------|-------------|------|
| `browser_navigate` | Open URL in preview | LOW |
| `browser_screenshot` | Capture screenshot | LOW |
| `browser_click` | Click element | LOW |

### MCP Tools
| Tool | Description | Risk |
|------|-------------|------|
| `mcp_*` | Dynamic MCP server tools | Varies |

### Deployment Tools
| Tool | Description | Risk |
|------|-------------|------|
| `deploy` | Deploy to provider | HIGH |
| `rollback` | Rollback deployment | HIGH |

## Tool Interface

Every tool implements:

```typescript
interface Tool {
  identity: {
    name: string;
    description: string;
    category: "filesystem" | "terminal" | "git" | "browser" | "mcp" | "deployment";
  };
  permissions: {
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    requiresApproval: boolean;
    allowedInSandbox: boolean;
    allowedInBridge: boolean;
    allowedInRemote: boolean;
  };
  validate(input: unknown): { valid: boolean; errors?: string[] };
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
```

## Risk Levels

| Level | Approval | Examples |
|-------|----------|----------|
| LOW | Auto-approved | Read file, git status, list files |
| MEDIUM | Auto-approved | Write file, git commit, edit file |
| HIGH | Requires approval | Delete file, git push, run command, deploy |
| CRITICAL | Always requires approval | Force push, drop database, rm -rf |

## Tool Execution Flow

```
Agent requests tool
       ↓
Permission Engine evaluates
       ↓
  ┌────┴────┐
  ↓         ↓
ALLOW    APPROVAL_REQUIRED
  ↓         ↓
Execute  Show approval dialog
  ↓         ↓
Result   User approves/denies
  ↓         ↓
  └────┬────┘
       ↓
  Record in trace
```

## Execution Environments

### Local Bridge
- Runs on user's machine via WebSocket gateway
- Full access to local filesystem and tools
- Required for: git operations, local dev server, native dependencies

### Cloud Sandbox
- Isolated container environment
- Limited to approved operations
- Good for: code generation, testing, preview

### Remote Server
- SSH access to remote machines
- Used for: production deployment, remote testing

## Adding Custom Tools

Use the extension system:

```typescript
import { ToolExtension } from "@ai-harness/extension-system";

const myTool: ToolExtension = {
  manifest: {
    name: "my-custom-tool",
    version: "1.0.0",
    description: "Custom tool for specific operations",
    author: "developer",
    type: "tool",
    capabilities: { tools: ["my-custom-tool"] },
    permissions: { filesystem: "read", network: "none" },
    minPlatformVersion: "0.1.0",
  },
  async activate(context) { /* ... */ },
  async deactivate() { /* ... */ },
  getToolDefinitions() {
    return [{
      name: "my-custom-tool",
      description: "Performs custom operation",
      category: "custom",
      riskLevel: "LOW",
      inputSchema: { type: "object", properties: { input: { type: "string" } } },
    }];
  },
  async executeTool(name, input, context) {
    // Implementation
    return { result: "success" };
  },
};

// Register
registry.register(myTool);
```

## MCP Integration

MCP (Model Context Protocol) servers provide additional tools:

```typescript
// Register MCP server
POST /v1/mcp/servers
{
  "name": "my-mcp-server",
  "transport": "stdio",
  "command": "node",
  "args": ["mcp-server.js"],
  "enabled": true
}

// MCP tools appear automatically in the tool registry
// Agents can discover and use them like built-in tools
```

## Audit Logging

Every tool execution is logged:

```typescript
{
  toolName: "run_command",
  taskId: "task_123",
  runId: "run_456",
  input: { command: "npm test" },
  output: { exitCode: 0, stdout: "..." },
  durationMs: 1234,
  riskLevel: "HIGH",
  approved: true,
  timestamp: "2025-01-15T10:30:00Z"
}
```
