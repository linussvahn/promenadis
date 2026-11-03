import { translate } from "@promenadis/i18n";
import { CalendarDays, MapPin, Route } from "lucide-react";
import { useStoredLocale } from "../lib/locale";
import { cn } from "../lib/utils";
import { Eyebrow, SiteFooter } from "./page";
import { SiteFrame } from "./site-frame";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function Welcome() {
  const { locale, setLocale } = useStoredLocale();

  return (
    <SiteFrame locale={locale} onLocaleChange={setLocale}>
      <main className="grid gap-8 pt-6 pb-16 sm:pt-10" id="main" tabIndex={-1}>
        <section
          aria-labelledby="hero-title"
          className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]"
        >
          <div className="grid max-w-2xl gap-6">
            <Eyebrow>{translate(locale, "home.eyebrow")}</Eyebrow>
            <h1
              className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] sm:text-7xl"
              id="hero-title"
            >
              {translate(locale, "home.title")}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {translate(locale, "home.intro")}
            </p>
            <p>
              <Button asChild size="lg">
                <a href="/discover">{translate(locale, "home.discover")}</a>
              </Button>
            </p>
          </div>

          <div
            aria-hidden="true"
            className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl border bg-card bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-[size:1.25rem_1.25rem] lg:aspect-square"
          >
            <span className="absolute inset-[20%_18%_18%] rotate-[-12deg] rounded-full border-[0.25rem] border-dashed border-primary border-y-transparent" />
            <RoutePin className="top-[14%] left-[14%]">1</RoutePin>
            <RoutePin className="top-[44%] left-[46%]" tone="dark">
              2
            </RoutePin>
            <RoutePin className="right-[14%] bottom-[12%]">3</RoutePin>
          </div>
        </section>

        <section aria-labelledby="foundation-title" className="grid gap-5">
          <div className="grid max-w-2xl gap-3">
            <Badge>{translate(locale, "home.discoveryStatus")}</Badge>
            <h2 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl" id="foundation-title">
              {translate(locale, "home.next")}
            </h2>
            <p className="text-lg leading-relaxed text-muted-foreground">
              {translate(locale, "home.discoveryBody")}
            </p>
          </div>
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {(
              [
                ["home.itemEvents", CalendarDays],
                ["home.itemStops", MapPin],
                ["home.itemRoute", Route],
              ] as const
            ).map(([key, Icon], index) => (
              <li
                className="flex min-h-44 flex-col justify-between gap-6 rounded-3xl border bg-card p-6"
                key={key}
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-8 place-items-center rounded-full bg-secondary text-sm font-semibold">
                    {index + 1}
                  </span>
                  <Icon aria-hidden="true" className="size-5 text-primary" />
                </div>
                <span className="text-lg leading-snug font-semibold tracking-tight">
                  {translate(locale, key)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <SiteFooter>
        <p>{translate(locale, "home.footer")}</p>
      </SiteFooter>
    </SiteFrame>
  );
}

function RoutePin({
  className,
  tone = "leaf",
  children,
}: {
  readonly className: string;
  readonly tone?: "leaf" | "dark";
  readonly children: string;
}) {
  return (
    <span
      className={cn(
        "absolute isolate grid size-13 place-items-center font-bold text-background",
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-0 -z-10 -rotate-45 rounded-[50%_50%_50%_0] border-4 border-card shadow-lg",
          tone === "dark" ? "bg-foreground" : "bg-primary",
        )}
      />
      {children}
    </span>
  );
}
