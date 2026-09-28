import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-[#0B1020] hover:bg-brand-hover active:bg-brand-active font-semibold",
  secondary: "bg-surface-3 text-text-primary hover:bg-border border border-border",
  ghost: "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
  danger: "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
  outline: "border border-border-strong text-text-primary hover:bg-surface-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "default" | "sm";
  loading?: boolean;
  asChild?: boolean;
}

/** Min height 36px (default); loading buttons prevent duplicate submission (guidelines §4). */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", loading = false, asChild = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg text-sm transition-colors select-none",
          size === "sm" ? "h-8 px-2.5" : "h-9 px-3",
          "disabled:pointer-events-none disabled:text-text-disabled disabled:bg-surface-2",
          variants[variant],
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
