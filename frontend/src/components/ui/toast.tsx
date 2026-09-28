"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "warning" | "info";

const variantStyles: Record<ToastVariant, string> = {
  success: "border-success/30 bg-success/10 text-success",
  error: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
};

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

const ToastContext = React.createContext<{
  toast: (title: string, opts?: { description?: string; variant?: ToastVariant }) => void;
}>({ toast: () => {} });

export function useToast() {
  return React.useContext(ToastContext);
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback(
    (title: string, opts?: { description?: string; variant?: ToastVariant }) => {
      const id = Math.random().toString(36).slice(2, 9);
      setToasts((prev) => [...prev, { id, title, description: opts?.description, variant: opts?.variant ?? "info" }]);
    },
    [],
  );

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastPrimitive.Provider duration={4000}>
        <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <ToastItemCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

function ToastItemCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = ICONS[toast.variant];
  return (
    <ToastPrimitive.Root
      open
      onOpenChange={(open) => { if (!open) onDismiss(); }}
      className={cn(
        "pointer-events-auto flex w-full items-center gap-3 rounded-lg border p-3 pr-8 text-[12px] shadow-lg transition-all",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out",
        variantStyles[toast.variant],
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <ToastPrimitive.Title className="font-medium">{toast.title}</ToastPrimitive.Title>
        {toast.description && (
          <ToastPrimitive.Description className="mt-0.5 text-[11px] opacity-80">{toast.description}</ToastPrimitive.Description>
        )}
      </div>
      <ToastPrimitive.Close className="absolute right-2 top-2 rounded-md p-0.5 opacity-50 hover:opacity-100 transition-opacity">
        <X className="h-3 w-3" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}
