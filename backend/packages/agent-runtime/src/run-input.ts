/** RunInput exactly as defined by AGENT_RUNTIME.md §3. */

export interface RunInput {
  taskId: string;
  runId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  goal: string;
  constraints: string | null;
  agentMode: "BUILD" | "PLAN" | "ASK" | "REVIEW" | "FIX";
  selectedModelMode: "MANUAL" | "ROUTED";
  /** MANUAL mode override resolved against provider connections. */
  modelOverride: { providerConnectionId: string; modelIdentifier: string } | null;
  workspaceInstructionVersion: number | null;
  policySnapshotId: string;
}
