import { useHydrated } from "@tanstack/react-router";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex w-fit max-w-full cursor-pointer items-center justify-center gap-2 rounded-full text-center text-sm leading-tight font-semibold no-underline transition-[color,background-color,border-color,box-shadow,transform] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary-hover",
        destructive: "bg-destructive-solid text-white shadow-sm hover:bg-destructive-solid/90",
        outline:
          "border border-input bg-card text-foreground shadow-xs hover:border-foreground hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground hover:bg-accent",
        link: "h-auto px-1 text-link underline underline-offset-4 hover:decoration-2",
      },
      size: {
        default: "min-h-11 px-5 py-2 has-[>svg]:px-4",
        sm: "min-h-9 px-3.5 py-1.5 text-[0.8125rem] has-[>svg]:px-3",
        lg: "min-h-12 px-7 py-2.5 text-base has-[>svg]:px-5",
        icon: "size-11",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto min-h-11 px-1 py-1" }],
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  // Forms here submit through JavaScript; before hydration a click would
  // post the form natively and reload the page with its fields cleared.
  const hydrated = useHydrated();
  const Comp = asChild ? Slot.Root : "button";
  const waiting = !asChild && props.type === "submit" && !hydrated;
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || waiting}
      {...props}
    />
  );
}

export { Button, buttonVariants };
