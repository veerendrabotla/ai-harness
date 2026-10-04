import { z } from "zod";
import { executionModeSchema, workspaceRoleSchema } from "./enums.js";
import { emptyToUndefined } from "./helpers.js";

// ── Workspaces ───────────────────────────────────────────────

export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  executionMode: executionModeSchema.default("CLOUD"),
  initialInstructions: z.string().max(100_000).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  executionMode: executionModeSchema.optional(),
});
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

// ── Members ──────────────────────────────────────────────────

export const addMemberRequestSchema = z.object({
  email: z.string().email().max(320),
  role: workspaceRoleSchema.refine((r) => r !== "OWNER", {
    message: "Ownership is transferred explicitly, not granted by invite",
  }),
});
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;

export const updateMemberRequestSchema = z.object({
  role: workspaceRoleSchema,
});
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

// ── Projects ─────────────────────────────────────────────────

export const createProjectRequestSchema = z.object({
  name: z.string().min(1).max(160),
  connectionType: z.enum(["CLOUD", "LOCAL_BRIDGE"]).default("CLOUD"),
  repositoryUrl: emptyToUndefined(z.string().url().max(2000)),
  // "/" = workspace/project root. Optional in the SDK contract; CLOUD projects
  // store it as-is and LOCAL_BRIDGE callers should send their registered root.
  rootReference: z.string().min(1).max(2000).default("/"),
  defaultBranch: emptyToUndefined(z.string().max(255)),
  bridgeId: emptyToUndefined(z.string().uuid()),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  repositoryUrl: z.string().url().max(2000).nullable().optional(),
  defaultBranch: z.string().max(255).nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

// ── Invites ──────────────────────────────────────────────────

export const createInviteRequestSchema = z.object({
  email: z.string().email().max(320),
  role: workspaceRoleSchema.refine((r) => r !== "OWNER", {
    message: "Ownership cannot be invited",
  }),
});
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

export const acceptInviteRequestSchema = z.object({
  token: z.string().min(10).max(200),
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;

export interface WorkspaceInviteDto {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}