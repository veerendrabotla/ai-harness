import { z } from "zod";
import { modelSelectionModeSchema, agentModeSchema } from "./enums.js";

export const createTaskRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid(),
    goal: z.string().min(4).max(20_000),
    constraints: z.string().max(10_000).optional(),
    agentMode: agentModeSchema.default("BUILD"),
    selectedModelMode: modelSelectionModeSchema.default("ROUTED"),
    modelOverride: z
      .object({
        providerConnectionId: z.string().uuid(),
        modelIdentifier: z.string().min(1).max(255),
      })
      .optional(),
  })
  .refine(
    (v) =>
      v.selectedModelMode !== "MANUAL" ||
      (v.modelOverride?.providerConnectionId && v.modelOverride.modelIdentifier),
    { message: "MANUAL model mode requires modelOverride with providerConnectionId and modelIdentifier" },
  );
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export interface TaskDto {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  goal: string;
  constraints: string | null;
  state: string;
  agentMode: "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX";
  selectedModelMode: "MANUAL" | "ROUTED";
  overrideProviderConnectionId: string | null;
  overrideModelIdentifier: string | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface TaskRunDto {
  id: string;
  taskId: string;
  runNumber: number;
  state: string;
  startedAt: string | null;
  endedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}
