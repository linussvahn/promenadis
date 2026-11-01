import { type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";

export function LanguageSwitcher({
  locale,
  onChange,
}: {
  readonly locale: Locale;
  readonly onChange: (locale: Locale) => void;
}) {
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    setInteractive(true);
  }, []);

  return (
    <fieldset className="language-switcher">
      <legend className="visually-hidden">{translate(locale, "home.language")}</legend>
      <button
        aria-pressed={locale === "sv"}
        disabled={!interactive}
        onClick={() => onChange("sv")}
        type="button"
      >
        SV
        <span className="visually-hidden"> — {translate(locale, "language.sv")}</span>
      </button>
      <button
        aria-pressed={locale === "en"}
        disabled={!interactive}
        lang="en"
        onClick={() => onChange("en")}
        type="button"
      >
        EN
        <span className="visually-hidden"> — {translate(locale, "language.en")}</span>
      </button>
    </fieldset>
  );
}
