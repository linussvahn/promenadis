import { type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField } from "./ui/field";

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
    <Card asChild>
      <section aria-labelledby="notification-preferences-heading">
        <CardHeader>
          <CardTitle id="notification-preferences-heading">
            {translate(locale, "notifications.preferences")}
          </CardTitle>
          <CardDescription>{translate(locale, "notifications.requiredHint")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-2">
          <ChoiceField className="rounded-xl border bg-muted/40 p-4">
            <Checkbox
              checked={reminders ?? false}
              disabled={reminders === null}
              onChange={(event) => void change(event.currentTarget.checked)}
            />
            <span>{translate(locale, "notifications.reminders")}</span>
          </ChoiceField>
          <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
