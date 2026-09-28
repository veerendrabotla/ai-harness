/**
 * Deployment state machine.
 * Enforces legal transitions and provides status helpers.
 */

export type DeploymentStatus =
  | "QUEUED"
  | "PREPARING"
  | "BUILDING"
  | "DEPLOYING"
  | "HEALTH_CHECKING"
  | "READY"
  | "FAILED"
  | "CANCELLED"
  | "ROLLED_BACK";

export const DEPLOYMENT_STATES: DeploymentStatus[] = [
  "QUEUED",
  "PREPARING",
  "BUILDING",
  "DEPLOYING",
  "HEALTH_CHECKING",
  "READY",
  "FAILED",
  "CANCELLED",
  "ROLLED_BACK",
];

const TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  QUEUED: ["PREPARING", "FAILED", "CANCELLED"],
  PREPARING: ["BUILDING", "FAILED", "CANCELLED"],
  BUILDING: ["DEPLOYING", "FAILED", "CANCELLED"],
  DEPLOYING: ["HEALTH_CHECKING", "FAILED", "CANCELLED"],
  HEALTH_CHECKING: ["READY", "FAILED", "CANCELLED"],
  READY: ["ROLLED_BACK"],
  FAILED: [],
  CANCELLED: [],
  ROLLED_BACK: [],
};

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid deployment transition: ${from} → ${to}`);
  }
}

export function isTerminal(status: DeploymentStatus): boolean {
  return ["READY", "FAILED", "CANCELLED", "ROLLED_BACK"].includes(status);
}

export function isActive(status: DeploymentStatus): boolean {
  return !isTerminal(status);
}

export function statusLabel(status: DeploymentStatus): string {
  const labels: Record<DeploymentStatus, string> = {
    QUEUED: "Queued",
    PREPARING: "Preparing",
    BUILDING: "Building",
    DEPLOYING: "Deploying",
    HEALTH_CHECKING: "Health Check",
    READY: "Ready",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
    ROLLED_BACK: "Rolled Back",
  };
  return labels[status] ?? status;
}
