import { type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

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
      className={cn(
        "h-9 min-w-10 cursor-pointer rounded-full px-2 text-sm font-bold text-foreground transition-colors disabled:cursor-default",
        locale === value ? "bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
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
    <fieldset className="m-0 flex rounded-full border bg-card p-0.5">
      <legend className="sr-only">{translate(locale, "home.language")}</legend>
      {option("sv", "SV")}
      {option("en", "EN")}
    </fieldset>
  );
}
