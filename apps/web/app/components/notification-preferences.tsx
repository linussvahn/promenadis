import { type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField } from "./ui/field";

type Client = {
  readonly api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
  readonly token: string;
};

// Required notices (decisions, cancellations, security) always arrive;
// reminders are optional and off until the account turns them on.
export function NotificationPreferences({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const preferencesKey = accountKey(useExpectedAccountId(), "notification-preferences");
  const [status, setStatus] = useState("");

  const call = async (): Promise<Client | null> => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  };

  const preferencesQuery = useQuery({
    queryKey: preferencesKey,
    queryFn: async (): Promise<boolean | null> => {
      const client = await call();
      return client
        ? (await client.api.getNotificationPreferences(client.token)).eventReminders
        : null;
    },
  });
  // A failed read shows reminders as off and lets the account turn them on.
  const reminders = preferencesQuery.data ?? (preferencesQuery.isError ? false : null);

  const changeMutation = useMutation({
    mutationFn: async ({ api, token, next }: Client & { next: boolean }) =>
      (await api.setNotificationPreferences(token, next)).eventReminders,
    onSuccess: (eventReminders) => {
      queryClient.setQueryData(preferencesKey, eventReminders);
      setStatus(translate(locale, "notifications.saved"));
    },
    onError: () => setStatus(translate(locale, "notifications.saveFailed")),
  });

  const change = async (next: boolean) => {
    const client = await call();
    if (!client) return;
    changeMutation.mutate({ ...client, next });
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
