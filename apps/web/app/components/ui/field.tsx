import type * as React from "react";
import { cn } from "../../lib/utils";

/** Layout helpers after shadcn's Field: label, control and hint stacked. */
function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("grid gap-5", className)} {...props} />;
}

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={cn("grid gap-2", className)} {...props} />;
}

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn("m-0 grid min-w-0 gap-3 border-0 p-0", className)}
      {...props}
    />
  );
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return (
    <legend
      data-slot="field-legend"
      className={cn("mb-1 p-0 text-sm font-semibold", className)}
      {...props}
    />
  );
}

/** A checkbox or radio with its label text beside it. */
function ChoiceField({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is a child.
    <label
      data-slot="choice-field"
      className={cn(
        "flex cursor-pointer items-start gap-3 text-sm leading-snug font-medium [&_small]:block [&_small]:pt-0.5 [&_small]:font-normal [&_small]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("max-w-prose text-sm leading-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

export { ChoiceField, Field, FieldDescription, FieldGroup, FieldLegend, FieldSet };
