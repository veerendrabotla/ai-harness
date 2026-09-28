import { create } from "zustand";
import type { UserDto } from "@ai-harness/contracts";
import { apiFetch } from "./api-client.js";
import { disconnectSocket } from "./use-task-socket.js";

interface AuthState {
  user: UserDto | null;
  accessToken: string | null;
  status: "loading" | "authenticated" | "unauthenticated";
  setSession: (user: UserDto, accessToken: string) => void;
  clearSession: () => void;
  hydrate: () => Promise<void>;
}

/**
 * Session store. The access token lives in memory only; the refresh token
 * rides an httpOnly cookie so a reopened PWA silently restores the session.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: "loading",
  setSession: (user, accessToken) => set({ user, accessToken, status: "authenticated" }),
  clearSession: () => {
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
      set({ user: data.user, accessToken: data.accessToken, status: "authenticated" });
    } catch {
      set({ user: null, accessToken: null, status: "unauthenticated" });
    }
  },
}));
