"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="flex flex-col items-center p-6 text-center max-w-sm">
        <AlertCircle className="h-8 w-8 text-danger mb-3" />
        <CardTitle className="text-sm font-semibold text-text-primary mb-1">
          Admin Panel Error
        </CardTitle>
        <p className="text-xs text-text-muted mb-4">
          {error.message || "Failed to load admin panel. Please try again."}
        </p>
        <Button variant="outline" onClick={reset} className="gap-1.5">
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      </Card>
    </div>
  );
}
