import { type Locale, translate } from "@promenadis/i18n";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

/** Navigation entries in the header: links or buttons styled as ghost pills. */
export const headerNavItem =
  "inline-flex h-11 shrink-0 cursor-pointer items-center rounded-full border-0 bg-transparent px-3.5 text-[0.95rem] font-semibold text-foreground no-underline transition-colors hover:bg-accent disabled:opacity-50 aria-[current=page]:bg-brand-soft aria-[current=page]:text-primary";

export function PageHeader({
  locale,
  onLocaleChange,
  action,
}: {
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly action?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 [grid-template-areas:'brand_appearance'_'nav_nav'] sm:grid-cols-[auto_1fr_auto] sm:py-4 sm:[grid-template-areas:'brand_nav_appearance']">
      <a
        aria-label={translate(locale, "app.name")}
        className="inline-flex min-h-11 items-center gap-2.5 font-display text-xl font-extrabold tracking-tight text-foreground no-underline [grid-area:brand]"
        href="/"
      >
        <span
          aria-hidden="true"
          className="grid size-9 -rotate-45 place-items-center rounded-[50%_50%_50%_0.35rem] bg-primary text-base text-primary-foreground shadow-[inset_0_-0.2rem_0_rgb(0_0_0/12%)]"
        >
          <span className="rotate-45">P</span>
        </span>
        {translate(locale, "app.name")}
      </a>
      {action ? (
        <div className="-mx-2 flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [grid-area:nav] sm:mx-0 sm:justify-end sm:overflow-visible [&_nav]:flex [&_nav]:items-center [&_nav]:gap-1">
          {action}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 [grid-area:appearance]">
        <ThemeSwitcher locale={locale} />
        <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
      </div>
    </header>
  );
}
