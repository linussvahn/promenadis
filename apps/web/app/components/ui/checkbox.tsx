import type * as React from "react";
import { cn } from "../../lib/utils";

/**
 * A native checkbox in the shadcn style. Native inputs keep form posts,
 * labels and keyboard behaviour exactly as the browser defines them.
 */
function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "peer mt-0.5 size-5 shrink-0 cursor-pointer rounded-[0.35rem] border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Radio({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="radio"
      data-slot="radio"
      className={cn(
        "peer mt-0.5 size-5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox, Radio };
