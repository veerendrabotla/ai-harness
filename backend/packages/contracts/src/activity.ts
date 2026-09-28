import { z } from "zod";

export const taskEventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type TaskEventsQuery = z.infer<typeof taskEventsQuerySchema>;

export interface TaskEventDto {
  id: string;
  taskId: string;
  runId: string | null;
  sequenceNumber: number;
  eventType: string;
  actorType: "USER" | "SYSTEM" | "AGENT" | "TOOL" | "BRIDGE";
  payload: Record<string, unknown> | null;
  createdAt: string;
}

// ── Approvals ────────────────────────────────────────────────

export interface ApprovalRequestDto {
  id: string;
  taskId: string;
  toolCallId: string | null;
  requestedScope: "ONCE" | "TASK";
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
  requestedByActor: "AGENT" | "SYSTEM";
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  toolCall?: ToolCallDto | undefined;
}

// ── Tool calls ───────────────────────────────────────────────

export interface ToolCallDto {
  id: string;
  taskId: string;
  runId: string;
  toolName: string;
  riskLevel: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL";
  inputSummary: Record<string, unknown>;
  status:
    | "PENDING"
    | "WAITING_APPROVAL"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "TIMED_OUT"
    | "DENIED"
    | "CANCELLED";
  resultSummary: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
}

// ── Context / changes / checkpoints / verification ──────────

export interface ContextPackageDto {
  id: string;
  taskId: string;
  runId: string;
  stage: "PLANNING" | "IMPLEMENTATION" | "REVIEW";
  manifest: ContextManifestDto;
  estimatedTokens: number;
  createdAt: string;
}

export interface ContextManifestItem {
  sourceType: string;
  identifier: string;
  inclusionReason: string;
  sizeBytes: number;
  redactionStatus: "REDACTED" | "CLEAN" | "OMITTED";
}

export interface ContextManifestDto {
  items: ContextManifestItem[];
  omitted: ContextManifestItem[];
  budgetBytes: number;
  usedBytes: number;
}

export interface CheckpointDto {
  id: string;
  taskId: string;
  projectId: string;
  checkpointType: "PRE_EXECUTION" | "MANUAL";
  stateReference: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface VerificationResultDto {
  id: string;
  taskId: string;
  runId: string;
  command: string;
  status: "PASSED" | "FAILED" | "SKIPPED" | "ERROR";
  outputReference: string | null;
  createdAt: string;
}
