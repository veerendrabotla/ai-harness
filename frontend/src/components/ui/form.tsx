"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("block text-sm font-medium text-text-secondary", className)}
    {...props}
  />
));
Label.displayName = "Label";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text-primary",
        "placeholder:text-text-muted focus:border-brand focus:outline-none focus-visible:outline-none",
        "disabled:text-text-disabled",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary",
      "placeholder:text-text-muted focus:border-brand focus:outline-none min-h-24",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/** Secret input with show/hide control (guidelines §4 forms). */
export function SecretInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={props.className} />
      <button
        type="button"
        aria-label={visible ? "Hide value" : "Show value"}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text-primary",
        "focus:border-brand focus:outline-none focus-visible:outline-none",
        "disabled:text-text-disabled",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
