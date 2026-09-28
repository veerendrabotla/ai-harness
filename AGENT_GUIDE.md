# AI Harness — Agent Guide

## Overview

AI Harness uses a multi-agent system to accomplish software engineering tasks. The agent runtime orchestrates specialized agents through a plan → approve → execute → verify loop.

## Agent Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `CODE` | Full autonomous coding | Build features, fix bugs |
| `PLAN` | Planning only | Analyze requirements, create plans |
| `BUILD` | Builder mode | Prompt-to-app experience |

## Multi-Agent Architecture

```
Supervisor
  ├── Planner      — Creates step-by-step plans
  ├── Coder        — Writes and modifies code
  ├── Reviewer     — Reviews code quality
  ├── Tester       — Runs tests and verifies
  └── DevOps       — Handles deployment
```

### Supervisor
- Analyzes the goal and selects the appropriate agent
- Delegates tasks based on capability matching
- Monitors progress and handles failures

### Planner
- Creates structured plans with ordered steps
- Each step specifies: description, tool to use, expected outcome
- Plans are presented to the user for approval before execution

### Coder
- Implements the plan by writing and modifying code
- Uses filesystem, terminal, and git tools
- Creates checkpoints before destructive operations

### Reviewer
- Reviews code changes for quality, security, and correctness
- Provides actionable feedback
- Can trigger self-fix loops

### Tester
- Runs project-appropriate tests (typecheck, lint, unit, integration)
- Reports failures with details
- Supports framework-specific test detection

### DevOps
- Handles deployment to configured providers
- Manages build processes
- Performs health checks

## Task Lifecycle

```
QUEUED → PLANNING → PLAN_APPROVAL → EXECUTING → VERIFYING → COMPLETED
                        ↓                              ↓
                    PAUSED/REJECTED                SELF_FIX → EXECUTING
                                                       ↓
                                                  FAILED
```

## Creating Tasks

```typescript
// Via API
POST /v1/tasks
{
  "goal": "Add user authentication with OAuth",
  "projectId": "proj_123",
  "agentMode": "CODE"
}

// Via SDK
const task = await client.createTask({
  goal: "Add user authentication with OAuth",
  projectId: "proj_123",
});

// Via CLI
aiharness build "Add user authentication with OAuth" --project proj_123
```

## Plan Approval

When the planner creates a plan, it requires user approval:

```typescript
// Approve plan
POST /v1/tasks/:taskId/plans/:planId/approve

// Reject plan with reason
POST /v1/tasks/:taskId/plans/:planId/reject
{ "reason": "Missing test coverage requirement" }

// Revise plan
POST /v1/tasks/:taskId/plans/:planId/revise
{ "instructions": "Add database migration step" }
```

## Tool Approval

High-risk tools require approval before execution:

```typescript
// Approve tool execution
POST /v1/approvals/:approvalId/approve

// Deny tool execution
POST /v1/approvals/:approvalId/deny
{ "reason": "Use a safer alternative" }
```

## Memory System

The agent remembers project-specific knowledge:

- **Architecture decisions** — Why certain patterns were chosen
- **Coding conventions** — Style, naming, structure preferences
- **Lessons learned** — What worked and what didn't
- **User preferences** — How the user likes things done

Memory is automatically:
- Retrieved before each task execution
- Reinforced when patterns are confirmed
- Decayed when patterns become outdated

## Checkpoints

Checkpoints capture the project state before destructive operations:

```typescript
// List checkpoints
GET /v1/tasks/:taskId/checkpoints

// Restore a checkpoint
POST /v1/checkpoints/:checkpointId/restore
```

## Observability

Every agent run produces a detailed trace:

- Reasoning steps — What the agent was thinking
- Plan steps — What was planned and executed
- Tool calls — What tools were used with inputs/outputs
- Verification results — What checks passed/failed
- Token usage — How many tokens were consumed

Access traces via:
```typescript
GET /v1/tasks/:taskId/traces
GET /v1/runs/:runId/trace
```

## Self-Fix Loop

When verification fails, the agent automatically:

1. Analyzes the failure
2. Creates a fix plan
3. Implements the fix
4. Re-runs verification
5. Repeats until fixed or max retries reached

Max retries: 3 (configurable per workspace)

## Cancellation and Pause

```typescript
// Pause a running task
POST /v1/tasks/:taskId/pause

// Resume a paused task
POST /v1/tasks/:taskId/resume

// Cancel a task
POST /v1/tasks/:taskId/cancel
```
