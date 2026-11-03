import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export const skipLink =
  "fixed top-3 left-3 z-50 -translate-y-[200%] rounded-lg bg-primary px-4 py-3 text-primary-foreground no-underline focus:translate-y-0";

const widths = {
  app: "max-w-6xl",
  flow: "mx-auto max-w-3xl",
  wide: "mx-auto max-w-5xl",
} as const;

/** The page's <main>: `flow` for single-column forms, `app` for workspaces. */
export function PageMain({
  width = "app",
  className,
  children,
  ...props
}: React.ComponentProps<"main"> & { readonly width?: keyof typeof widths }) {
  return (
    <main
      className={cn("grid gap-6 pt-4 pb-16 sm:pt-8", widths[width], className)}
      id="main"
      tabIndex={-1}
      {...props}
    >
      {children}
    </main>
  );
}

/** Eyebrow, h1, lede and optional actions at the top of a page. */
export function PageHeading({
  eyebrow,
  title,
  titleId,
  description,
  actions,
  meta,
  className,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly titleId?: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
  readonly className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="grid max-w-3xl gap-3">
        {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1
          className="text-4xl leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-5xl"
          id={titleId}
        >
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "m-0 text-xs font-extrabold tracking-[0.08em] text-primary uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** "← Back" link above a heading. */
export const backLink =
  "inline-flex w-fit min-h-11 items-center gap-1.5 font-semibold text-link no-underline hover:underline";

export function EmptyState({
  mark = "P",
  title,
  children,
  action,
}: {
  readonly mark?: ReactNode;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <section className="grid max-w-2xl justify-items-start gap-3 rounded-2xl border bg-card p-8 shadow-sm sm:p-12">
      <span aria-hidden="true" className="relative isolate grid size-12 place-items-center">
        <span className="absolute inset-0 -z-10 -rotate-45 rounded-[50%_50%_50%_0] bg-primary" />
        <span className="font-display text-lg font-extrabold text-primary-foreground">{mark}</span>
      </span>
      <h2 className="mt-2 text-2xl font-extrabold">{title}</h2>
      {children ? (
        <div className="max-w-xl text-base leading-relaxed text-muted-foreground">{children}</div>
      ) : null}
      {action}
    </section>
  );
}

export function SiteFooter({ children }: { readonly children: ReactNode }) {
  return (
    <footer className="mt-12 border-t py-8 text-sm text-muted-foreground [&_a]:text-inherit">
      {children}
    </footer>
  );
}

/** Definition list of label/value rows, e.g. an event's time and place. */
export function SummaryList({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      className={cn(
        "m-0 grid divide-y [&>div]:grid [&>div]:gap-1 [&>div]:py-3.5 [&>div]:first:pt-0 [&>div]:last:pb-0 sm:[&>div]:grid-cols-[minmax(8rem,0.4fr)_1fr] sm:[&>div]:gap-4 [&_dd]:m-0 [&_dd]:leading-relaxed [&_dt]:text-sm [&_dt]:font-semibold [&_dt]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
