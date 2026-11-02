import { translate } from "@promenadis/i18n";
import { useStoredLocale } from "../lib/locale";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

export function Welcome() {
  const { locale, setLocale } = useStoredLocale();

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {translate(locale, "home.skip")}
      </a>

      <header className="site-header">
        <a className="wordmark" href="/" aria-label={translate(locale, "app.name")}>
          <span aria-hidden="true" className="wordmark-mark">
            P
          </span>
          {translate(locale, "app.name")}
        </a>

        <nav className="header-actions" aria-label={translate(locale, "app.name")}>
          <a className="header-action" href="/discover">
            {translate(locale, "nav.discover")}
          </a>
          <a className="header-action" href="/sign-in">
            {translate(locale, "nav.signIn")}
          </a>
          <div className="appearance-controls">
            <ThemeSwitcher locale={locale} />
            <LanguageSwitcher locale={locale} onChange={setLocale} />
          </div>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">{translate(locale, "home.eyebrow")}</p>
            <h1 id="hero-title">{translate(locale, "home.title")}</h1>
            <p className="lede">{translate(locale, "home.intro")}</p>
            <p>
              <a className="primary-button button-link" href="/discover">
                {translate(locale, "home.discover")}
              </a>
            </p>
          </div>

          <div className="route-illustration" aria-hidden="true">
            <span className="route-line" />
            <span className="route-stop route-stop-one">1</span>
            <span className="route-stop route-stop-two">2</span>
            <span className="route-stop route-stop-three">3</span>
          </div>
        </section>

        <section className="foundation-card" aria-labelledby="foundation-title">
          <div>
            <p className="status-pill">{translate(locale, "home.discoveryStatus")}</p>
            <h2 id="foundation-title">{translate(locale, "home.next")}</h2>
            <p>{translate(locale, "home.discoveryBody")}</p>
          </div>
          <ol className="feature-list">
            <li>{translate(locale, "home.itemEvents")}</li>
            <li>{translate(locale, "home.itemStops")}</li>
            <li>{translate(locale, "home.itemRoute")}</li>
          </ol>
        </section>
      </main>

      <footer className="site-footer">
        <p>{translate(locale, "home.footer")}</p>
      </footer>
    </div>
  );
}
