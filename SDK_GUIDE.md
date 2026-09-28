# AI Harness — SDK Guide

## Installation

```bash
npm install @ai-harness/sdk
```

## Quick Start

```typescript
import { AiHarnessClient } from "@ai-harness/sdk";

const client = new AiHarnessClient({
  baseUrl: "https://api.aiharness.dev",
  apiKey: "your-api-key",
});

// Create a task
const task = await client.createTask({
  goal: "Build a REST API for user management",
  projectId: "proj_123",
});

console.log(`Task created: ${task.id}`);

// Stream events
for await (const event of client.streamEvents(task.id)) {
  console.log(`${event.type}: ${JSON.stringify(event.data)}`);
}
```

## Authentication

### API Key
```typescript
const client = new AiHarnessClient({
  baseUrl: "https://api.aiharness.dev",
  apiKey: "ah_live_...",
});
```

### JWT Token
```typescript
const client = new AiHarnessClient({
  baseUrl: "https://api.aiharness.dev",
  token: "eyJhbGciOiJIUzI1NiIs...",
});
```

## Projects

```typescript
// List projects
const projects = await client.listProjects("ws_123");

// Create project
const project = await client.createProject("ws_123", {
  name: "My Project",
  description: "A new web application",
});
```

## Tasks

```typescript
// Create task
const task = await client.createTask({
  goal: "Add user authentication",
  projectId: "proj_123",
  agentMode: "CODE",
});

// Get task status
const status = await client.getTask(task.id);

// Pause task
await client.pauseTask(task.id);

// Resume task
await client.resumeTask(task.id);

// Cancel task
await client.cancelTask(task.id);
```

## Plans

```typescript
// Get task with plans
const task = await client.getTask(task.id);
const plan = task.plans[0];

// Approve plan
await client.approvePlan(task.id, plan.id);

// Reject plan
await client.rejectPlan(task.id, plan.id, "Missing test coverage");

// Revise plan
await client.revisePlan(task.id, plan.id, "Add database migration step");
```

## Tool Approvals

```typescript
// Stream events to get approval requests
for await (const event of client.streamEvents(task.id)) {
  if (event.type === "TOOL_APPROVAL_REQUIRED") {
    const approvalId = event.data.approvalId;
    
    // Approve
    await client.approveTool(approvalId);
    
    // Or deny
    await client.denyTool(approvalId, "Use a safer alternative");
  }
}
```

## Streaming Events

```typescript
// Stream all events for a task
for await (const event of client.streamEvents(task.id)) {
  switch (event.type) {
    case "PLAN_CREATED":
      console.log("Plan created:", event.data.plan);
      break;
    case "PLAN_APPROVAL_REQUIRED":
      console.log("Approval needed:", event.data.planId);
      break;
    case "TOOL_STARTED":
      console.log("Tool running:", event.data.toolName);
      break;
    case "TOOL_COMPLETED":
      console.log("Tool done:", event.data.toolName);
      break;
    case "RUN_COMPLETED":
      console.log("Task completed!");
      break;
  }
}
```

## Deployments

```typescript
// Create deployment
const deployment = await client.createDeployment("proj_123", {
  provider: "vercel",
  environment: "production",
});

// Get deployment status
const status = await client.getDeployment(deployment.id);
```

## Memory

```typescript
// Query project memory
const memories = await client.queryMemory("proj_123", "authentication patterns");

// Add memory
await client.addMemory("proj_123", {
  content: "Use bcrypt for password hashing",
  category: "CONVENTION",
});
```

## Checkpoints

```typescript
// List checkpoints
const checkpoints = await client.listCheckpoints(task.id);

// Restore checkpoint
await client.restoreCheckpoint(checkpoints[0].id);
```

## Error Handling

```typescript
import { AiHarnessClient, SDKError } from "@ai-harness/sdk";

try {
  await client.createTask({ goal: "..." });
} catch (err) {
  if (err instanceof SDKError) {
    console.error(`API Error (${err.status}): ${err.message}`);
    console.error("Response body:", err.body);
  }
}
```

## TypeScript Types

The SDK provides full TypeScript support:

```typescript
import type { 
  SDKConfig, 
  RequestOptions 
} from "@ai-harness/sdk";
```
