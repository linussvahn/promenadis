import type * as React from "react";
import { cn } from "../../lib/utils";
import { fieldClasses } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClasses, "field-sizing-content min-h-28 resize-y", className)}
      {...props}
    />
  );
}

export { Textarea };
