import { type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";

// Required notices (decisions, cancellations, security) always arrive;
// reminders are optional and off until the account turns them on.
export function NotificationPreferences({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const [reminders, setReminders] = useState<boolean | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void (async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      try {
        setReminders((await api.getNotificationPreferences(token)).eventReminders);
      } catch {
        setReminders(false);
      }
    })();
  }, [accessToken]);

  const change = async (next: boolean) => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    try {
      setReminders((await api.setNotificationPreferences(token, next)).eventReminders);
      setStatus(translate(locale, "notifications.saved"));
    } catch {
      setStatus(translate(locale, "notifications.saveFailed"));
    }
  };

  return (
    <section aria-labelledby="notification-preferences-heading" className="panel form-panel">
      <h2 id="notification-preferences-heading">
        {translate(locale, "notifications.preferences")}
      </h2>
      <p className="field-hint">{translate(locale, "notifications.requiredHint")}</p>
      <label className="checkbox-field">
        <input
          checked={reminders ?? false}
          disabled={reminders === null}
          onChange={(event) => void change(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{translate(locale, "notifications.reminders")}</span>
      </label>
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
