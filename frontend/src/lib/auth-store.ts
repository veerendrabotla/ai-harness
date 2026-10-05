import { create } from "zustand";
import type { UserDto } from "@ai-harness/contracts";
import { apiFetch } from "./api-client.js";
import { disconnectSocket } from "./use-task-socket.js";

interface AuthState {
  user: UserDto | null;
  accessToken: string | null;
  status: "loading" | "authenticated" | "unauthenticated";
  setSession: (user: UserDto, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => void;
  hydrate: () => Promise<void>;
}

/**
 * Mirror the access token into a first-party `session` cookie on the APP
 * origin. The API sets a host-only cookie on the API origin, which never
 * reaches the app when they are split origins (e.g. Vercel frontend + remote
 * API) — without this, middleware redirects every protected route to /login.
 * Same value the API sets, so same-host deploys just overwrite it in place.
 */
export function buildSessionCookie(token: string, secure: boolean, nowMs: number = Date.now()): string {
  let maxAge = 900;
  try {
    const payload = token.split(".")[1];
    if (payload) {
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "=");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const json = JSON.parse(atob(padded)) as { exp?: number };
      if (typeof json.exp === "number") {
        maxAge = Math.max(Math.floor(json.exp - nowMs / 1000), 60);
      }
    }
  } catch {
    // Non-JWT or undecodable payload — fall back to the default TTL.
  }
  return `session=${token}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function writeSessionCookie(token: string): void {
  if (typeof document === "undefined") return;
  document.cookie = buildSessionCookie(token, window.location.protocol === "https:");
}

function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `session=; Path=/; Max-Age=0${window.location.protocol === "https:" ? "; Secure" : ""}`;
}

/**
 * Session store. The access token lives in memory only; the refresh token
 * rides an httpOnly cookie so a reopened PWA silently restores the session.
 * The `session` mirror cookie exists purely for the app-origin middleware.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: "loading",
  setSession: (user, accessToken) => {
    writeSessionCookie(accessToken);
    set({ user, accessToken, status: "authenticated" });
  },
  setAccessToken: (accessToken) => {
    writeSessionCookie(accessToken);
    set({ accessToken });
  },
  clearSession: () => {
    clearSessionCookie();
    set({ user: null, accessToken: null, status: "unauthenticated" });
    disconnectSocket();
    void apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => {
      // Logout API failure is non-critical - local session is already cleared
    });
  },
  hydrate: async () => {
    try {
      const data = await apiFetch<{ user: UserDto; accessToken: string }>("/v1/auth/refresh", {
        method: "POST",
        json: {},
        skipAuth: true,
        retryOn401: false,
      });
      writeSessionCookie(data.accessToken);
      set({ user: data.user, accessToken: data.accessToken, status: "authenticated" });
    } catch {
      clearSessionCookie();
      set({ user: null, accessToken: null, status: "unauthenticated" });
    }
  },
}));
