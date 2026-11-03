import { translate } from "@promenadis/i18n";
import { useStoredLocale } from "../lib/locale";
import { cn } from "../lib/utils";
import { Eyebrow, SiteFooter, siteShell, skipLink } from "./page";
import { headerNavItem, PageHeader } from "./page-header";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function Welcome() {
  const { locale, setLocale } = useStoredLocale();

  return (
    <div className={siteShell}>
      <a className={skipLink} href="#main">
        {translate(locale, "home.skip")}
      </a>

      <PageHeader
        action={
          <nav aria-label={translate(locale, "app.name")}>
            <a className={headerNavItem} href="/discover">
              {translate(locale, "nav.discover")}
            </a>
            <a className={headerNavItem} href="/sign-in">
              {translate(locale, "nav.signIn")}
            </a>
          </nav>
        }
        locale={locale}
        onLocaleChange={setLocale}
      />

      <main id="main" tabIndex={-1}>
        <section
          aria-labelledby="hero-title"
          className="grid min-h-[34rem] items-center gap-10 py-10 sm:py-20 lg:grid-cols-[1.3fr_0.7fr]"
        >
          <div className="grid max-w-2xl gap-5">
            <Eyebrow>{translate(locale, "home.eyebrow")}</Eyebrow>
            <h1
              className="max-w-[12ch] text-5xl leading-[0.98] font-extrabold tracking-[-0.04em] sm:text-7xl lg:text-8xl"
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
            className="relative aspect-square w-full max-w-[26rem] justify-self-center rounded-[46%_54%_52%_48%/52%_44%_56%_48%] bg-warning-soft"
          >
            <span className="absolute inset-[18%_16%_14%] rotate-[-12deg] rounded-full border-[0.3rem] border-dashed border-primary border-y-transparent" />
            <RoutePin className="top-[12%] left-[12%]">1</RoutePin>
            <RoutePin className="top-[46%] left-[46%]" tone="primary">
              2
            </RoutePin>
            <RoutePin className="right-[12%] bottom-[10%]">3</RoutePin>
          </div>
        </section>

        <section
          aria-labelledby="foundation-title"
          className="grid gap-10 rounded-3xl bg-[#2f5d46] p-8 text-[#fff8ee] shadow-xl sm:p-14 lg:grid-cols-[1.1fr_0.9fr] dark:bg-[#24392d]"
        >
          <div className="grid content-start justify-items-start gap-4">
            <Badge>{translate(locale, "home.discoveryStatus")}</Badge>
            <h2 className="text-3xl font-extrabold sm:text-4xl" id="foundation-title">
              {translate(locale, "home.next")}
            </h2>
            <p className="max-w-2xl leading-relaxed">{translate(locale, "home.discoveryBody")}</p>
          </div>
          <ol className="m-0 grid list-none content-center gap-4 p-0">
            {(["home.itemEvents", "home.itemStops", "home.itemRoute"] as const).map(
              (key, index) => (
                <li className="grid grid-cols-[2.75rem_1fr] items-center gap-4" key={key}>
                  <span className="grid size-11 place-items-center rounded-full bg-sun font-display font-extrabold text-sun-foreground">
                    {index + 1}
                  </span>
                  {translate(locale, key)}
                </li>
              ),
            )}
          </ol>
        </section>
      </main>

      <SiteFooter>
        <p>{translate(locale, "home.footer")}</p>
      </SiteFooter>
    </div>
  );
}

function RoutePin({
  className,
  tone = "leaf",
  children,
}: {
  readonly className: string;
  readonly tone?: "leaf" | "primary";
  readonly children: string;
}) {
  return (
    <span
      className={cn(
        "absolute isolate grid size-13 place-items-center font-display font-extrabold text-primary-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-0 -z-10 -rotate-45 rounded-[50%_50%_50%_0] border-4 border-card shadow-lg",
          tone === "primary" ? "bg-primary" : "bg-success",
        )}
      />
      {children}
    </span>
  );
}
