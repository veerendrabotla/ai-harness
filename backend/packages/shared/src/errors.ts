/**
 * Structured application errors.
 * Codes mirror BACKEND_STRUCTURE.md §4 exactly.
 */

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "RATE_LIMITED",
  "WORKSPACE_ARCHIVED",
  "PROJECT_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "POLICY_DENIED",
  "TOOL_TIMEOUT",
  "BRIDGE_DISCONNECTED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  WORKSPACE_ARCHIVED: 409,
  PROJECT_UNAVAILABLE: 409,
  PROVIDER_UNAVAILABLE: 503,
  APPROVAL_REQUIRED: 409,
  APPROVAL_EXPIRED: 409,
  POLICY_DENIED: 403,
  TOOL_TIMEOUT: 504,
  BRIDGE_DISCONNECTED: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const errors = {
  unauthenticated: (message = "Authentication required") =>
    new AppError("UNAUTHENTICATED", message),
  forbidden: (message = "You do not have permission to perform this action") =>
    new AppError("FORBIDDEN", message),
  notFound: (entity: string) =>
    new AppError("NOT_FOUND", `${entity} not found`),
  validation: (message = "Invalid request", details?: Record<string, unknown>) =>
    new AppError("VALIDATION_ERROR", message, details),
  conflict: (message: string) => new AppError("CONFLICT", message),
  rateLimited: (message = "Too many requests") =>
    new AppError("RATE_LIMITED", message),
  workspaceArchived: () =>
    new AppError("WORKSPACE_ARCHIVED", "This workspace is archived"),
  projectUnavailable: (message = "The project root is currently unavailable") =>
    new AppError("PROJECT_UNAVAILABLE", message),
  providerUnavailable: (message = "No model provider is available for this stage") =>
    new AppError("PROVIDER_UNAVAILABLE", message),
  approvalRequired: (message = "Approval is required") =>
    new AppError("APPROVAL_REQUIRED", message),
  approvalExpired: () => new AppError("APPROVAL_EXPIRED", "This approval has expired"),
  policyDenied: (message = "Denied by workspace policy") =>
    new AppError("POLICY_DENIED", message),
  toolTimeout: (message = "Tool execution timed out") =>
    new AppError("TOOL_TIMEOUT", message),
  bridgeDisconnected: (message = "Local Bridge is not connected") =>
    new AppError("BRIDGE_DISCONNECTED", message),
  internal: (message = "An unexpected internal error occurred") =>
    new AppError("INTERNAL_ERROR", message),
};
