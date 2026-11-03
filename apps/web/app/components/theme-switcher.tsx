import type { Locale } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { NativeSelect } from "./ui/native-select";

type Theme = "system" | "light" | "dark";

export function ThemeSwitcher({ locale }: { readonly locale: Locale }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    const sync = () => {
      let value: string | null = null;
      try {
        value = localStorage.getItem("promenadis-theme");
      } catch {
        // Device preference still works when browser storage is unavailable.
      }
      const next = value === "light" || value === "dark" ? value : "system";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    sync();
    setInteractive(true);
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return (
    <label className="block w-[5.75rem]">
      <span className="sr-only">{locale === "sv" ? "Färgtema" : "Theme"}</span>
      <NativeSelect
        className="h-10 rounded-full border-border px-3 pr-8 text-sm"
        disabled={!interactive}
        value={theme}
        onChange={(event) => {
          const next = event.target.value as Theme;
          setTheme(next);
          document.documentElement.dataset.theme = next;
          try {
            localStorage.setItem("promenadis-theme", next);
          } catch {
            // Keep the selection for this page even if persistence is blocked.
          }
        }}
      >
        <option value="system">Auto</option>
        <option value="light">{locale === "sv" ? "Ljust" : "Light"}</option>
        <option value="dark">{locale === "sv" ? "Mörkt" : "Dark"}</option>
      </NativeSelect>
    </label>
  );
}
