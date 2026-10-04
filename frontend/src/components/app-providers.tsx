"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bindTokenApplier, bindTokenGetter } from "@/lib/api-client";
import { reconnectSocketWithToken } from "@/lib/use-task-socket";
import { useAuthStore } from "@/lib/auth-store";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui/toast";
import { MultiplayerProvider } from "@/components/multiplayer-provider";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: false },
    },
  });
}

let client: QueryClient | undefined;

// Bound at module load, not inside an effect: child effects run before this
// component's effect, so queries fired by pages on their first mount (e.g.
// onboarding's providers/workspaces) would otherwise send no Authorization
// header, get a 401, and silently re-authenticate before succeeding.
bindTokenGetter(() => useAuthStore.getState().accessToken);
bindTokenApplier((token) => {
  if (!token) return;
  // Refresh responses only carry a token; user stays as-is.
  useAuthStore.setState({ accessToken: token });
  // Reconnect the socket with the fresh token
  reconnectSocketWithToken();
});

/**
 * Auth gate + providers. Restores the session from the refresh cookie on load
 * (deep-link friendly), redirects unauthenticated users to /login preserving
 * the requested route.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qcRef = React.useRef<QueryClient>(undefined);
  if (!qcRef.current) qcRef.current = client ?? makeQueryClient();
  if (!client) client = qcRef.current;

  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);

  React.useEffect(() => {
    // Skip hydration if the user just logged in via the login/signup pages
    // (their session is already active; calling refresh would rotate the
    // token out from under them).
    if (useAuthStore.getState().status !== "authenticated") {
      void hydrate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (status === "unauthenticated") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [status, router]);

  React.useEffect(() => {
    // Expose the access token for the socket handshake without localStorage.
    (window as unknown as { __ahAccessToken?: string }).__ahAccessToken =
      useAuthStore.getState().accessToken ?? undefined;
  }, [status]);

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-text-muted">
        <span aria-live="polite">Restoring session…</span>
      </div>
    );
  }

  return (
    <QueryClientProvider client={qcRef.current}>
      <MultiplayerProvider>
        <Toaster>
          {children}
        </Toaster>
        <CommandPalette />
      </MultiplayerProvider>
    </QueryClientProvider>
  );
}
