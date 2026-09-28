"use client";

import { useEffect, useState } from "react";
import { useMultiplayer } from "@/components/multiplayer-provider";

interface CollaborativeCursorProps {
  currentFile?: string;
}

export function CollaborativeCursor({ currentFile }: CollaborativeCursorProps) {
  const { users, localColor } = useMultiplayer();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  const others = users.filter((u) => u.color !== localColor && u.cursor);

  useEffect(() => {
    const interval = setInterval(() => {
      setPositions((prev) => {
        const next = new Map(prev);
        for (const user of others) {
          if (user.cursor && (!currentFile || user.cursor.file === currentFile)) {
            const existing = prev.get(user.userId);
            next.set(user.userId, {
              x: existing ? existing.x : user.cursor.column * 8.4,
              y: existing ? existing.y : user.cursor.line * 20,
            });
          }
        }
        return next;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [others, currentFile]);

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {others.map((user) => {
        if (!user.cursor || (currentFile && user.cursor.file !== currentFile)) return null;
        const pos = positions.get(user.userId);
        const x = pos?.x ?? user.cursor.column * 8.4;
        const y = pos?.y ?? user.cursor.line * 20;
        return (
          <div
            key={user.userId}
            className="absolute transition-all duration-100 ease-out"
            style={{ left: x, top: y }}
          >
            <svg
              width="16"
              height="20"
              viewBox="0 0 16 20"
              fill="none"
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
            >
              <path
                d="M0 0L16 12L8 12L4 20L0 0Z"
                fill={user.color}
              />
            </svg>
            <span
              className="absolute left-4 top-4 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
