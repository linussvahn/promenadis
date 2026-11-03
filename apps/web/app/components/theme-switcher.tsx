import type { Locale } from "@promenadis/i18n";
import { Contrast, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

type Theme = "system" | "light" | "dark";

/** A segment in the bottom-of-sidebar pill controls. */
export const segment =
  "grid h-9 min-w-9 cursor-pointer place-items-center rounded-full px-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground has-checked:bg-card has-checked:text-foreground has-checked:shadow-sm has-disabled:cursor-default has-focus-visible:outline-2 has-focus-visible:outline-ring aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm dark:has-checked:bg-secondary dark:aria-pressed:bg-secondary";

export const segmentGroup = "m-0 flex w-fit rounded-full border-0 bg-secondary/70 p-1 dark:bg-card";

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

  const choose = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("promenadis-theme", next);
    } catch {
      // Keep the selection for this page even if persistence is blocked.
    }
  };

  const options = [
    { icon: Contrast, label: "Auto", value: "system" },
    { icon: Sun, label: locale === "sv" ? "Ljust" : "Light", value: "light" },
    { icon: Moon, label: locale === "sv" ? "Mörkt" : "Dark", value: "dark" },
  ] as const;

  return (
    <fieldset className={segmentGroup}>
      <legend className="sr-only">{locale === "sv" ? "Färgtema" : "Theme"}</legend>
      {options.map(({ icon: Icon, label, value }) => (
        <label className={cn(segment, "relative")} key={value} title={label}>
          <input
            checked={theme === value}
            className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-full opacity-0"
            disabled={!interactive}
            name="promenadis-theme"
            onChange={() => choose(value)}
            type="radio"
            value={value}
          />
          <Icon aria-hidden="true" className="size-4" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
