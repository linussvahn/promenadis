import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils";

const alertVariants = cva(
  "relative w-full max-w-2xl rounded-xl border px-4 py-3 text-sm leading-relaxed has-[>svg]:grid has-[>svg]:grid-cols-[1.25rem_1fr] has-[>svg]:items-start has-[>svg]:gap-x-3 has-[>svg]:gap-y-1 [&>svg]:size-5 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        destructive: "border-destructive/40 bg-destructive-soft text-destructive-foreground",
        warning: "border-sun/60 bg-warning-soft text-warning-foreground",
        success: "border-success/40 bg-success-soft text-success-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

/**
 * shadcn's Alert without a default role: callers choose role="alert" or
 * role="status" so screen readers announce only what should interrupt.
 */
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("col-start-2 grid justify-items-start gap-2 [&_p]:leading-relaxed", className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
