/**
 * API base URL — resolved at RUNTIME so Docker deployments can inject it
 * via /env.js (window.__ENV__.API_URL) without rebuilding the image.
 * Build-time NEXT_PUBLIC_API_URL is the fallback for local dev; setting it
 * to an empty string means same-origin (Vercel services routing sends
 * /v1/* to the api service on this domain).
 */
function resolveApiUrl(): string {
  if (typeof window !== "undefined") {
    const runtime = (window as unknown as { __ENV__?: { API_URL?: string } }).__ENV__?.API_URL;
    if (runtime) return runtime;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

const API_URL = resolveApiUrl();

export class ApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(code: string, message: string, details?: Record<string, unknown>, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

type TokenGetter = () => string | null;
let getAccessToken: TokenGetter = () => null;

export function bindTokenGetter(fn: TokenGetter): void {
  getAccessToken = fn;
}

let refreshing: Promise<boolean> | null = null;

/** Silent refresh using the httpOnly cookie; safe to call concurrently. */
export function silentRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const payload = (await res.json()) as { data?: { accessToken: string } };
        return Boolean(payload.data?.accessToken) && applyRefreshedToken(payload.data!.accessToken);
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

let tokenApplier: ((token: string | null) => void) | null = null;
export function bindTokenApplier(fn: (token: string | null) => void): void {
  tokenApplier = fn;
}
function applyRefreshedToken(token: string): boolean {
  tokenApplier?.(token);
  return true;
}

export interface ApiFetchOptions {
  method?: string;
  json?: unknown;
  skipAuth?: boolean;
  retryOn401?: boolean;
  timeoutMs?: number;
}

/** Envelope-aware API client with one automatic 401 → refresh → retry cycle. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", json, skipAuth = false, retryOn401 = true, timeoutMs = 30_000 } = options;

  const doCall = () => {
    const token = skipAuth ? null : getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const promise = fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    }).finally(() => clearTimeout(timer));
    return promise;
  };

  let res = await doCall();

  if (res.status === 401 && retryOn401 && !skipAuth) {
    const refreshed = await silentRefresh();
    if (refreshed) res = await doCall();
  }

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Malformed JSON — surface as generic internal error without leaking details
    throw new ApiError("INTERNAL_ERROR", `Malformed response from server (${res.status})`);
  }

  const envelope = payload as { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; requestId?: string };

  if (!res.ok || envelope.error) {
    throw new ApiError(
      envelope.error?.code ?? "INTERNAL_ERROR",
      envelope.error?.message ?? "Request failed",
      envelope.error?.details,
      envelope.requestId,
    );
  }
  return envelope.data as T;
}

export const apiUrl = API_URL;

/**
 * Absolute origin of the API for URL builders that cannot take relative
 * URLs (socket.io, y-websocket). An empty API_URL means same-origin, so
 * resolve against the page origin.
 */
export function apiOrigin(): string {
  if (API_URL) return API_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:4000";
}
