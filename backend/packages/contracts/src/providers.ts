import { z } from "zod";
import { modelStageSchema, providerTypeSchema } from "./enums.js";

// ── Instructions ─────────────────────────────────────────────

export const saveInstructionsRequestSchema = z.object({
  content: z.string().max(200_000),
});
export type SaveInstructionsRequest = z.infer<typeof saveInstructionsRequestSchema>;

// ── Policy ───────────────────────────────────────────────────

export const policyUpdateRequestSchema = z.object({
  requirePlanApproval: z.boolean().optional(),
  allowDirectExecution: z.boolean().optional(),
  maxTaskDurationSeconds: z.number().int().min(60).max(86_400).optional(),
  maxToolCallsPerRun: z.number().int().min(1).max(500).optional(),
  maxSubagents: z.number().int().min(0).max(5).optional(),
  blockOnReviewFindings: z.boolean().optional(),
  toolRules: z
    .array(
      z.object({
        toolName: z.string().min(1).max(120),
        actionPattern: z.string().max(500).nullable().optional(),
        riskLevel: z.enum(["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL"]),
        decision: z.enum(["ALLOW", "ASK", "DENY"]),
      }),
    )
    .optional(),
});
export type PolicyUpdateRequest = z.infer<typeof policyUpdateRequestSchema>;

// ── Provider connections ─────────────────────────────────────

export const providerTypesWithCredential = providerTypeSchema.exclude(["OLLAMA", "OPENAI_COMPATIBLE", "TEST"]);

/** Local/self-hosted providers that authenticate by endpoint, not API key. */
export const CREDENTIAL_OPTIONAL_PROVIDER_TYPES = new Set<string>(["OLLAMA", "OPENAI_COMPATIBLE"]);

const createProviderObjectSchema = z
  .object({
    providerType: providerTypeSchema,
    displayName: z.string().min(1).max(120),
    credential: z.string().min(8).max(4096).optional(),
    metadata: z.record(z.string()).optional(),
  })
  .refine(
    (d) => CREDENTIAL_OPTIONAL_PROVIDER_TYPES.has(d.providerType) || Boolean(d.credential),
    {
      message: "credential (min 8 chars) is required for this provider",
      path: ["credential"],
    },
  );

/**
 * TEST is a simulated adapter for e2e/integration runs (never in production).
 * Routes use this variant only when NODE_ENV !== "production".
 */
export const createProviderRequestSchemaWithTest = createProviderObjectSchema;

export const createProviderRequestSchema = createProviderObjectSchema.refine(
  (d) => d.providerType !== "TEST",
  {
    message: "TEST provider is for simulated runs only",
    path: ["providerType"],
  },
);
export type CreateProviderRequest = z.infer<typeof createProviderRequestSchema>;

export const updateProviderRequestSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  credential: z.string().min(8).max(4096).optional(),
});
export type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>;

export interface ProviderConnectionDto {
  id: string;
  providerType: z.infer<typeof providerTypeSchema>;
  displayName: string;
  status: "ACTIVE" | "DISABLED" | "ERROR";
  createdAt: string;
  updatedAt: string;
  /** Never contains credentials. */
  hasCredential: boolean;
}

export interface ProviderTestResultDto {
  ok: boolean;
  providerType: string;
  detail: string;
  latencyMs: number;
}

// ── Model routes ─────────────────────────────────────────────

export const upsertModelRoutesRequestSchema = z.object({
  routes: z.array(
    z.object({
      /** Existing route ids are preserved; new entries get server-generated ids. */
      id: z.string().uuid().optional(),
      stage: modelStageSchema,
      providerConnectionId: z.string().uuid(),
      modelIdentifier: z.string().min(1).max(255),
      priority: z.number().int().min(0).max(1000).default(100),
      active: z.boolean().default(true),
      fallbackRouteId: z.string().uuid().nullable().optional(),
    }),
  ),
});
export type UpsertModelRoutesRequest = z.infer<typeof upsertModelRoutesRequestSchema>;

export interface ModelRouteDto {
  id: string;
  workspaceId: string;
  stage: z.infer<typeof modelStageSchema>;
  providerConnectionId: string;
  modelIdentifier: string;
  fallbackRouteId: string | null;
  priority: number;
  active: boolean;
}
