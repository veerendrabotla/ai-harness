// Run lifecycle events
export const RunEvents = {
  RUN_CREATED: "RUN_CREATED",
  RUN_STARTED: "RUN_STARTED",
  RUN_COMPLETED: "RUN_COMPLETED",
  RUN_FAILED: "RUN_FAILED",
  RUN_PAUSED: "RUN_PAUSED",
  RUN_RESUMED: "RUN_RESUMED",
  RUN_CANCELLED: "RUN_CANCELLED",
} as const;

// Plan events
export const PlanEvents = {
  PLAN_CREATED: "PLAN_CREATED",
  PLAN_APPROVAL_REQUIRED: "PLAN_APPROVAL_REQUIRED",
  PLAN_APPROVED: "PLAN_APPROVED",
  PLAN_REJECTED: "PLAN_REJECTED",
  PLAN_REVISED: "PLAN_REVISED",
} as const;

// Tool events
export const ToolEvents = {
  TOOL_REQUESTED: "TOOL_REQUESTED",
  TOOL_APPROVAL_REQUIRED: "TOOL_APPROVAL_REQUIRED",
  TOOL_APPROVED: "TOOL_APPROVED",
  TOOL_DENIED: "TOOL_DENIED",
  TOOL_STARTED: "TOOL_STARTED",
  TOOL_COMPLETED: "TOOL_COMPLETED",
  TOOL_FAILED: "TOOL_FAILED",
  TOOL_OBSERVED: "TOOL_OBSERVED",
} as const;

// Agent events
export const AgentEvents = {
  AGENT_THINKING: "AGENT_THINKING",
  AGENT_REASONING: "AGENT_REASONING",
  AGENT_DELEGATED: "AGENT_DELEGATED",
  AGENT_COMMUNICATION: "AGENT_COMMUNICATION",
} as const;

// Self-fix events
export const SelfFixEvents = {
  SELF_FIX_ATTEMPTED: "SELF_FIX_ATTEMPTED",
  SELF_FIX_SUCCEEDED: "SELF_FIX_SUCCEEDED",
  SELF_FIX_FAILED: "SELF_FIX_FAILED",
} as const;

// Checkpoint events
export const CheckpointEvents = {
  CHECKPOINT_CREATED: "CHECKPOINT_CREATED",
  CHECKPOINT_RESTORED: "CHECKPOINT_RESTORED",
} as const;

// Verification events
export const VerificationEvents = {
  VERIFICATION_STARTED: "VERIFICATION_STARTED",
  VERIFICATION_COMPLETED: "VERIFICATION_COMPLETED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
} as const;

// Deployment events
export const DeploymentEvents = {
  DEPLOYMENT_STARTED: "DEPLOYMENT_STARTED",
  DEPLOYMENT_BUILDING: "DEPLOYMENT_BUILDING",
  DEPLOYMENT_DEPLOYING: "DEPLOYMENT_DEPLOYING",
  DEPLOYMENT_COMPLETED: "DEPLOYMENT_COMPLETED",
  DEPLOYMENT_FAILED: "DEPLOYMENT_FAILED",
  DEPLOYMENT_ROLLED_BACK: "DEPLOYMENT_ROLLED_BACK",
} as const;

// File events
export const FileEvents = {
  FILE_READ: "FILE_READ",
  FILE_WRITTEN: "FILE_WRITTEN",
  FILE_DELETED: "FILE_DELETED",
  FILE_RENAMED: "FILE_RENAMED",
} as const;

// All events combined
export const ALL_EVENTS = {
  ...RunEvents,
  ...PlanEvents,
  ...ToolEvents,
  ...AgentEvents,
  ...SelfFixEvents,
  ...CheckpointEvents,
  ...VerificationEvents,
  ...DeploymentEvents,
  ...FileEvents,
} as const;

export type EventType = typeof ALL_EVENTS[keyof typeof ALL_EVENTS];

export interface PlatformEvent {
  id: string;
  type: EventType;
  taskId: string;
  runId?: string;
  timestamp: Date;
  actor: "user" | "agent" | "system";
  data: Record<string, unknown>;
  metadata?: {
    userId?: string;
    agentRole?: string;
    toolName?: string;
    modelId?: string;
    durationMs?: number;
    tokenUsage?: { input: number; output: number };
  };
}

export interface EventFilter {
  types?: EventType[];
  taskId?: string;
  runId?: string;
  actor?: "user" | "agent" | "system";
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface EventStore {
  persist(event: PlatformEvent): Promise<void>;
  query(filter: EventFilter): Promise<PlatformEvent[]>;
  getEvent(id: string): Promise<PlatformEvent | null>;
}
