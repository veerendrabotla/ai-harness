import { z } from "zod";

export const exportSessionRequestSchema = z.object({
  includeHistory: z.boolean().default(true),
  includePlans: z.boolean().default(true),
  includeToolCalls: z.boolean().default(true),
  includeCheckpoints: z.boolean().default(false),
  includeContextPackages: z.boolean().default(false),
});
export type ExportSessionRequest = z.infer<typeof exportSessionRequestSchema>;

export const importSessionRequestSchema = z.object({
  packageJson: z.record(z.unknown()),
  targetWorkspaceId: z.string().uuid(),
  targetProjectId: z.string().uuid(),
});
export type ImportSessionRequest = z.infer<typeof importSessionRequestSchema>;

export const cloneSessionRequestSchema = z.object({
  goal: z.string().min(4).max(20_000).optional(),
});
export type CloneSessionRequest = z.infer<typeof cloneSessionRequestSchema>;

export const forkSessionRequestSchema = z.object({
  goal: z.string().min(4).max(20_000),
  targetWorkspaceId: z.string().uuid().optional(),
  targetProjectId: z.string().uuid().optional(),
});
export type ForkSessionRequest = z.infer<typeof forkSessionRequestSchema>;

export const shareSessionRequestSchema = z.object({
  permission: z.enum(["view_only", "continue", "fork"]).default("view_only"),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});
export type ShareSessionRequest = z.infer<typeof shareSessionRequestSchema>;

export const transferSessionRequestSchema = z.object({
  targetWorkspaceId: z.string().uuid(),
  targetProjectId: z.string().uuid(),
});
export type TransferSessionRequest = z.infer<typeof transferSessionRequestSchema>;

export interface SessionExportPackage {
  version: "1.0";
  exportedAt: string;
  source: {
    taskId: string;
    goal: string;
    constraints: string | null;
    agentMode: string;
    selectedModelMode: string;
    state: string;
    createdAt: string;
    completedAt: string | null;
  };
  history: Array<{
    eventType: string;
    actorType: string;
    payload: unknown;
    createdAt: string;
  }>;
  plans: Array<{
    version: number;
    analysis: string;
    affectedFiles: string[];
    steps: Array<{ title: string; detail?: string; acceptanceCriteria?: string[]; toolName?: string }>;
    risks: string[];
    verificationPlan: Array<{ command: string; asserts?: string[] }>;
    status: string;
  }>;
  toolCalls: Array<{
    toolName: string;
    riskLevel: string;
    inputSummary: unknown;
    resultSummary: unknown;
    status: string;
  }>;
  checkpoints: Array<{
    checkpointType: string;
    stateReference: unknown;
    createdAt: string;
  }>;
  contextPackages: Array<{
    stage: string;
    manifest: unknown;
    estimatedTokens: number;
  }>;
  metadata: {
    originalWorkspaceId: string;
    originalProjectId: string;
    exportedBy: string;
    hasSecrets: false;
  };
}
