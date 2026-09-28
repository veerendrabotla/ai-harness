/** Standard API envelope per BACKEND_STRUCTURE.md §4. */

export interface RequestMeta {
  requestId: string;
}

export interface ApiSuccessBody<T> {
  data: T;
  requestId: string;
}

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "WORKSPACE_ARCHIVED"
  | "PROJECT_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "POLICY_DENIED"
  | "TOOL_TIMEOUT"
  | "BRIDGE_DISCONNECTED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}
