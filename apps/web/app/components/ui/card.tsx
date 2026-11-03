import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";

type Slotted<T extends keyof React.JSX.IntrinsicElements> = React.ComponentProps<T> & {
  asChild?: boolean;
};

/** Pass `asChild` to keep a semantic element such as <section> or <li>. */
function Card({ className, asChild = false, ...props }: Slotted<"div">) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="card"
      className={cn(
        "flex flex-col gap-5 rounded-2xl border bg-card py-6 text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/4%)] dark:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

/** Renders an <h2> unless `asChild` wraps another heading level. */
function CardTitle({ className, asChild = false, ...props }: Slotted<"h2">) {
  const Comp = asChild ? Slot.Root : "h2";
  return (
    <Comp
      data-slot="card-title"
      className={cn("font-display text-xl leading-tight font-bold tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("grid gap-4 px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex flex-wrap items-center gap-3 px-6 [.border-t]:pt-5", className)}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
