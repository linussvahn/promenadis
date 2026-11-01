import { type Locale, translate } from "@promenadis/i18n";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

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
    <header className="site-header">
      <a className="wordmark" href="/" aria-label={translate(locale, "app.name")}>
        <span aria-hidden="true" className="wordmark-mark">
          P
        </span>
        {translate(locale, "app.name")}
      </a>
      <div className="header-actions">
        {action}
        <div className="appearance-controls">
          <ThemeSwitcher locale={locale} />
          <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
        </div>
      </div>
    </header>
  );
}
