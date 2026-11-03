import { type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { segment, segmentGroup } from "./theme-switcher";

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

  const option = (value: Locale, label: string) => (
    <button
      aria-pressed={locale === value}
      className={segment}
      disabled={!interactive}
      lang={value === "en" ? "en" : undefined}
      onClick={() => onChange(value)}
      type="button"
    >
      {label}
      <span className="sr-only"> — {translate(locale, `language.${value}`)}</span>
    </button>
  );

  return (
    <fieldset className={segmentGroup}>
      <legend className="sr-only">{translate(locale, "home.language")}</legend>
      {option("sv", "SV")}
      {option("en", "EN")}
    </fieldset>
  );
}
