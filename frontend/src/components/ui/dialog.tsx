"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const isLoading = loading || pending;

  const handleConfirm = React.useCallback(async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }, [onConfirm, onOpenChange]);

  const variantButton = variant === "danger" ? "danger" : variant === "warning" ? "primary" : "primary";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-surface-1 p-6 shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
          )}
        >
          <div className="flex items-start gap-3">
            <div className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              variant === "danger" && "bg-danger/15 text-danger",
              variant === "warning" && "bg-warning/15 text-warning",
              variant === "info" && "bg-info/15 text-info",
            )}>
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <DialogPrimitive.Title className="text-[14px] font-semibold text-text-primary">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 text-[12px] text-text-secondary leading-relaxed">
                {description}
              </DialogPrimitive.Description>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm" disabled={isLoading}>{cancelLabel}</Button>
            </DialogPrimitive.Close>
            <Button variant={variantButton} size="sm" loading={isLoading} onClick={() => void handleConfirm()}>
              {confirmLabel}
            </Button>
          </div>
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-text-muted hover:text-text-secondary transition-colors">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
