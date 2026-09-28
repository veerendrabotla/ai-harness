"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/lib/auth-store";
import { apiUrl } from "@/lib/api-client";

let globalSocket: Socket | null = null;

export function getSocket(): Socket {
  if (globalSocket?.connected) return globalSocket;
  if (globalSocket) globalSocket.disconnect();

  const token = useAuthStore.getState().accessToken;
  globalSocket = io(apiUrl, {
    auth: { token },
    transports: ["websocket"],
    autoConnect: false,
  });
  globalSocket.connect();
  return globalSocket;
}

/** Disconnect the global socket (called on logout). */
export function disconnectSocket(): void {
  if (globalSocket) {
    globalSocket.disconnect();
    globalSocket = null;
  }
}

/** Reconnect the socket with a fresh token after a token refresh. */
export function reconnectSocketWithToken(): void {
  if (!globalSocket) return;
  const newToken = useAuthStore.getState().accessToken;
  if (!newToken) return;
  globalSocket.auth = { token: newToken };
  globalSocket.disconnect();
  globalSocket.connect();
}

/**
 * Subscribe to realtime task events via Socket.IO.
 * Tracks last sequenceNumber and auto-replays missed events on reconnect
 * via GET /v1/tasks/:taskId/events?afterSequence=N.
 */
export function useTaskSocket(
  taskId: string | null,
  onEvent?: (event: unknown) => void,
  invalidateFn?: () => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const invalidateRef = useRef(invalidateFn);
  invalidateRef.current = invalidateFn;
  const lastSeqRef = useRef<number>(-1);

  useEffect(() => {
    if (!taskId) return;
    lastSeqRef.current = -1;
    const socket = getSocket();
    socket.emit("task:subscribe", { taskId });

    const handler = (event: unknown) => {
      const seq = (event as { sequenceNumber?: number })?.sequenceNumber;
      if (typeof seq === "number" && seq > lastSeqRef.current) {
        lastSeqRef.current = seq;
      }
      onEventRef.current?.(event);
      invalidateRef.current?.();
    };
    socket.on("task:event", handler);

    // On reconnect, replay missed events via REST
    const onConnect = async () => {
      socket.emit("task:subscribe", { taskId });
      if (lastSeqRef.current < 0) return;
      try {
        const { apiFetch } = await import("@/lib/api-client");
        const events = await apiFetch<Array<{ sequenceNumber: number } & Record<string, unknown>>>(
          `/v1/tasks/${taskId}/events?afterSequence=${lastSeqRef.current}&limit=500`,
        );
        for (const evt of events ?? []) {
          if (typeof evt.sequenceNumber === "number" && evt.sequenceNumber > lastSeqRef.current) {
            lastSeqRef.current = evt.sequenceNumber;
            onEventRef.current?.(evt);
          }
        }
        if (events?.length) invalidateRef.current?.();
      } catch {
        // Replay is best-effort; next poll or page refresh will catch up
      }
    };
    socket.on("connect", onConnect);

    return () => {
      socket.off("task:event", handler);
      socket.off("connect", onConnect);
      socket.emit("task:unsubscribe", { taskId });
    };
  }, [taskId]);
}
