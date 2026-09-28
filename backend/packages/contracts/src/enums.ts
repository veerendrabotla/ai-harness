import { z } from "zod";

/** Enum value lists mirror prisma/schema.prisma exactly. */

export const EXECUTION_MODES = ["CLOUD", "LOCAL_CONNECTED", "HYBRID"] as const;
export const WORKSPACE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const WORKSPACE_ROLES = ["OWNER", "MEMBER", "VIEWER"] as const;
export const CONNECTION_TYPES = ["CLOUD", "LOCAL_BRIDGE"] as const;
export const PROJECT_STATUSES = ["AVAILABLE", "DEGRADED", "UNAVAILABLE"] as const;
export const PROVIDER_TYPES = [
  "ANTHROPIC",
  "OPENAI",
  "GOOGLE",
  "OLLAMA",
  "OPENAI_COMPATIBLE",
  "TEST",
] as const;
export const MODEL_STAGES = ["PLANNING", "IMPLEMENTATION", "REVIEW"] as const;
export const TASK_STATES = [
  "QUEUED",
  "INITIALIZING",
  "UNDERSTANDING",
  "GATHERING_CONTEXT",
  "PLANNING",
  "WAITING_FOR_APPROVAL",
  "EXECUTING",
  "WAITING_FOR_TOOL_APPROVAL",
  "OBSERVING",
  "REPLANNING",
  "VERIFYING",
  "REVIEWING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
] as const;
export const TERMINAL_TASK_STATES = ["COMPLETED", "FAILED", "CANCELLED"] as const;
export const MODEL_SELECTION_MODES = ["MANUAL", "ROUTED"] as const;
export const PLAN_STATUSES = ["DRAFT", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export const RISK_LEVELS = ["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL"] as const;
export const PERMISSION_DECISIONS = ["ALLOW", "ASK", "DENY"] as const;
export const TOOL_CALL_STATUSES = [
  "PENDING",
  "WAITING_APPROVAL",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "DENIED",
  "CANCELLED",
] as const;
export const APPROVAL_SCOPES = ["ONCE", "TASK"] as const;
export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "DENIED", "EXPIRED"] as const;
export const EVENT_ACTOR_TYPES = ["USER", "SYSTEM", "AGENT", "TOOL", "BRIDGE"] as const;
export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;
export const VERIFICATION_STATUSES = ["PASSED", "FAILED", "SKIPPED", "ERROR"] as const;
export const BRIDGE_STATUSES = [
  "PENDING",
  "CONNECTED",
  "DEGRADED",
  "DISCONNECTED",
  "REVOKED",
] as const;
export const MCP_TRANSPORT_TYPES = ["STDIO", "HTTP", "SSE"] as const;
export const MCP_SERVER_STATUSES = ["DISABLED", "ACTIVE", "ERROR"] as const;
export const AGENT_MODES = ["BUILD", "PLAN", "ASK", "REVIEW", "FIX"] as const;

export const executionModeSchema = z.enum(EXECUTION_MODES);
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export const connectionTypeSchema = z.enum(CONNECTION_TYPES);
export const providerTypeSchema = z.enum(PROVIDER_TYPES);
export const modelStageSchema = z.enum(MODEL_STAGES);
export const taskStateSchema = z.enum(TASK_STATES);
export const modelSelectionModeSchema = z.enum(MODEL_SELECTION_MODES);
export const riskLevelSchema = z.enum(RISK_LEVELS);
export const permissionDecisionSchema = z.enum(PERMISSION_DECISIONS);
export const approvalScopeSchema = z.enum(APPROVAL_SCOPES);
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const eventActorTypeSchema = z.enum(EVENT_ACTOR_TYPES);
export const agentModeSchema = z.enum(AGENT_MODES);

export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type WorkspaceRoleName = z.infer<typeof workspaceRoleSchema>;
export type ConnectionType = z.infer<typeof connectionTypeSchema>;
export type ProviderType = z.infer<typeof providerTypeSchema>;
export type ModelStage = z.infer<typeof modelStageSchema>;
export type TaskStateDto = z.infer<typeof taskStateSchema>;
export type ModelSelectionMode = z.infer<typeof modelSelectionModeSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type PermissionDecisionValue = z.infer<typeof permissionDecisionSchema>;
export type EventActorType = z.infer<typeof eventActorTypeSchema>;
export type ApprovalScope = z.infer<typeof approvalScopeSchema>;
export type VerificationStatusValue = z.infer<typeof verificationStatusSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;
