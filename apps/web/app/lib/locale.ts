import { isLocale, type Locale } from "@promenadis/i18n";
import { useEffect, useState } from "react";

const localeStorageKey = "promenadis-locale";

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(localeStorageKey);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function useStoredLocale() {
  const [locale, setLocaleState] = useState<Locale>("sv");

  useEffect(() => {
    const stored = readStoredLocale();
    if (stored) setLocaleState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(localeStorageKey, nextLocale);
    } catch {
      // Storage is optional; the language still changes for this page view.
    }
  };

  return { locale, setLocale } as const;
}
