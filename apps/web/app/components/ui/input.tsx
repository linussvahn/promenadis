import type * as React from "react";
import { cn } from "../../lib/utils";

export const fieldClasses =
  "w-full min-w-0 rounded-lg border border-input bg-card px-3.5 py-2 text-base text-foreground shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground hover:border-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        "h-11 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
