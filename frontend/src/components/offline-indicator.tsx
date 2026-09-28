"use client";

/** Offline indicator (guidelines §7): stale-data aware, honest about connectivity. */
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineIndicator() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-[#0B1020]">
      <WifiOff className="h-4 w-4" aria-hidden />
      You are offline. Actions that need the server are disabled; live task events are paused.
    </div>
  );
}
