"use client";

import { useMultiplayer, type MultiplayerUser } from "@/components/multiplayer-provider";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_LABELS: Record<string, string> = {
  editing: "Editing",
  viewing: "Viewing",
  idle: "Idle",
};

const STATUS_DOTS: Record<string, string> = {
  editing: "bg-success",
  viewing: "bg-info",
  idle: "bg-text-muted",
};

function UserAvatar({ user }: { user: MultiplayerUser }) {
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: user.color }}
      title={user.name}
    >
      {initials}
    </div>
  );
}

export function MultiplayerPresence() {
  const { connected, users } = useMultiplayer();

  if (!connected) return null;

  return (
    <Card className="w-64">
      <CardHeader>
        <CardTitle className="text-sm">Collaborators ({users.length})</CardTitle>
      </CardHeader>
      <ul className="space-y-2">
        {users.map((user) => (
          <li key={user.userId} className="flex items-center gap-2">
            <UserAvatar user={user} />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">{user.name}</p>
              {user.cursor?.file ? (
                <p className="truncate text-xs text-text-muted">{user.cursor.file}</p>
              ) : null}
            </div>
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[user.status] ?? STATUS_DOTS.idle}`} />
              {STATUS_LABELS[user.status] ?? user.status}
            </span>
          </li>
        ))}
        {users.length === 0 ? (
          <li className="text-xs text-text-muted">No other collaborators</li>
        ) : null}
      </ul>
    </Card>
  );
}
