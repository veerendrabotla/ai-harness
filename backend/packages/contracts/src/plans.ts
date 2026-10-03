import { z } from "zod";

/** Structured plan produced by the planning stage (AGENT_RUNTIME.md §5). */

export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().default(""),
  /**
   * Spec-driven flow: short, objectively checkable claims that must hold once
   * the step completes. Empty for legacy plans; the verification engine only
   * enforces coverage for criteria that are present.
   */
  acceptanceCriteria: z.array(z.string().min(1).max(400)).max(6).default([]),
  /** Optional tool the step requires. Absent = pure reasoning/summary step. */
  toolName: z.string().max(120).optional(),
  toolInput: z.record(z.unknown()).optional(),
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const verificationPlanEntrySchema = z.object({
  command: z.string().min(1),
  /** Exact acceptance-criteria text this command proves when it passes. */
  asserts: z.array(z.string().min(1).max(400)).max(6).default([]),
});
export type VerificationPlanEntry = z.infer<typeof verificationPlanEntrySchema>;

export const planDraftSchema = z.object({
  analysis: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  affectedFiles: z.array(z.string()).default([]),
  steps: z.array(planStepSchema).min(1, "Plan must contain at least one step").max(50),
  risks: z.array(z.string()).default([]),
  verificationPlan: z.array(verificationPlanEntrySchema).default([]),
});
export type PlanDraft = z.infer<typeof planDraftSchema>;

export const planRevisionRequestSchema = z.object({
  instruction: z.string().min(1).max(5000),
});
export type PlanRevisionRequest = z.infer<typeof planRevisionRequestSchema>;

export interface TaskPlanDto {
  id: string;
  taskId: string;
  runId: string;
  version: number;
  analysis: string;
  affectedFiles: string[];
  steps: PlanStep[];
  risks: string[];
  verificationPlan: VerificationPlanEntry[];
  status: "DRAFT" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}
