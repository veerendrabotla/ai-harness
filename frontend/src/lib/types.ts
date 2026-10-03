/** Shared client-side DTO shapes (mirror backend serialization). */

export interface WorkspaceDtoLike {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  executionMode: "CLOUD" | "LOCAL_CONNECTED" | "HYBRID";
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  viewerRole?: string;
}

export interface ProjectDtoLike {
  id: string;
  workspaceId: string;
  name: string;
  connectionType: "CLOUD" | "LOCAL_BRIDGE";
  repositoryUrl: string | null;
  rootReference: string;
  status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  createdAt: string;
}

export interface TaskDtoLike {
  id: string;
  workspaceId: string;
  projectId: string;
  goal: string;
  constraints: string | null;
  state: string;
  selectedModelMode: "MANUAL" | "ROUTED";
  parentTaskId: string | null;
  inputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface PlanStepLike {
  id: string;
  title: string;
  detail?: string;
  acceptanceCriteria?: string[];
  toolName?: string;
}

export interface PlanLike {
  id: string;
  version: number;
  analysis: string;
  affectedFiles: string[];
  steps: PlanStepLike[];
  risks: string[];
  verificationPlan: Array<{ command: string; asserts?: string[] }>;
  status: "DRAFT" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  approvedAt: string | null;
}

export interface EventLike {
  id: string;
  taskId: string;
  sequenceNumber: number;
  eventType: string;
  actorType: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProviderLike {
  id: string;
  providerType: string;
  displayName: string;
  status: string;
  hasCredential: boolean;
  createdAt: string;
}

export interface RouteLike {
  id: string;
  stage: "PLANNING" | "IMPLEMENTATION" | "REVIEW";
  providerConnectionId: string;
  modelIdentifier: string;
  fallbackRouteId: string | null;
  priority: number;
  active: boolean;
}
