"use client";

/**
 * Multiplayer editing context provider.
 *
 * Uses Yjs for CRDT-based conflict-free editing and y-websocket for
 * real-time sync via the WebSocket gateway.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { apiUrl } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

export interface MultiplayerUser {
  userId: string;
  name: string;
  color: string;
  cursor?: { line: number; column: number; file?: string };
  selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number; file?: string };
  status: "editing" | "viewing" | "idle";
  joinedAt: number;
}

interface MultiplayerContextValue {
  connected: boolean;
  users: MultiplayerUser[];
  localColor: string | null;
  doc: Y.Doc | null;
  provider: WebsocketProvider | null;
  connect: (taskId: string) => void;
  disconnect: () => void;
  sendCursor: (line: number, column: number, file?: string) => void;
  sendSelection: (startLine: number, startColumn: number, endLine: number, endColumn: number, file?: string) => void;
  sendStatus: (status: "editing" | "viewing" | "idle") => void;
}

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function useMultiplayer() {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) throw new Error("useMultiplayer must be used within MultiplayerProvider");
  return ctx;
}

const USER_COLORS = [
  "#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd",
  "#56b6c2", "#be5046", "#d19a66", "#7ec8e3", "#a8d8a8",
];

function pickColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<MultiplayerUser[]>([]);
  const [localColor, setLocalColor] = useState<string | null>(null);
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const taskIdRef = useRef<string | null>(null);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback((taskId: string) => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    clearReconnect();
    reconnectAttemptRef.current = 0;
    taskIdRef.current = taskId;

    if (providerRef.current) {
      providerRef.current.destroy();
    }
    if (docRef.current) {
      docRef.current.destroy();
    }

    const yDoc = new Y.Doc();
    docRef.current = yDoc;
    setDoc(yDoc);

    const wsUrl = apiUrl.replace(/^http/, "ws");
    const wsProvider = new WebsocketProvider(wsUrl, `task-${taskId}`, yDoc, {
      connect: true,
      params: { taskId, token },
    });
    providerRef.current = wsProvider;
    setProvider(wsProvider);

    const color = pickColor(taskId);
    setLocalColor(color);

    // Set local user awareness
    wsProvider.awareness.setLocalStateField("user", {
      color,
      joinedAt: Date.now(),
    });

    // Track awareness changes
    const updateUsers = () => {
      const states = Array.from(wsProvider.awareness.getStates().entries());
      const mapped: MultiplayerUser[] = states
        .filter(([, state]) => state.user)
        .map(([clientId, state]) => ({
          userId: String(clientId),
          name: state.user?.name ?? `User ${clientId}`,
          color: state.user?.color ?? "#ccc",
          cursor: state.cursor,
          selection: state.selection,
          status: state.status ?? "idle",
          joinedAt: state.user?.joinedAt ?? Date.now(),
        }));
      setUsers(mapped);
    };

    wsProvider.awareness.on("change", updateUsers);

    wsProvider.on("status", ({ status }: { status: string }) => {
      setConnected(status === "connected");
      if (status === "connected") {
        reconnectAttemptRef.current = 0;
      }
    });

    wsProvider.on("connection-error", () => {
      const attempt = reconnectAttemptRef.current;
      if (attempt < 5) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptRef.current++;
          wsProvider.connect();
        }, delay);
      }
    });

    updateUsers();
  }, [clearReconnect]);

  const disconnect = useCallback(() => {
    clearReconnect();
    taskIdRef.current = null;
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
    if (docRef.current) {
      docRef.current.destroy();
      docRef.current = null;
    }
    setConnected(false);
    setUsers([]);
    setLocalColor(null);
    setDoc(null);
    setProvider(null);
  }, [clearReconnect]);

  const sendCursor = useCallback((line: number, column: number, file?: string) => {
    const p = providerRef.current;
    if (!p) return;
    p.awareness.setLocalStateField("cursor", { line, column, file });
  }, []);

  const sendSelection = useCallback((startLine: number, startColumn: number, endLine: number, endColumn: number, file?: string) => {
    const p = providerRef.current;
    if (!p) return;
    p.awareness.setLocalStateField("selection", { startLine, startColumn, endLine, endColumn, file });
  }, []);

  const sendStatus = useCallback((status: "editing" | "viewing" | "idle") => {
    const p = providerRef.current;
    if (!p) return;
    p.awareness.setLocalStateField("status", status);
  }, []);

  useEffect(() => {
    return () => {
      clearReconnect();
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, [clearReconnect]);

  const value = useMemo<MultiplayerContextValue>(() => ({
    connected,
    users,
    localColor,
    doc,
    provider,
    connect,
    disconnect,
    sendCursor,
    sendSelection,
    sendStatus,
  }), [connected, users, localColor, doc, provider, connect, disconnect, sendCursor, sendSelection, sendStatus]);

  return (
    <MultiplayerContext.Provider value={value}>
      {children}
    </MultiplayerContext.Provider>
  );
}
