import type { AccountNotifications } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "./ui/card";

// In-app copies of the account's notices for 30 days.
export function MyNotifications({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const notificationsKey = accountKey(useExpectedAccountId(), "notifications");
  const { data: items = [] } = useQuery({
    queryKey: notificationsKey,
    queryFn: async (): Promise<AccountNotifications> => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return [];
      return api.listNotifications(token);
    },
    // The events list above already reports session problems.
    throwOnError: false,
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return null;
      return api.markNotificationsRead(token);
    },
    // Unread state is cosmetic; on failure keep the list as it is.
    onSuccess: (next) => {
      if (next) queryClient.setQueryData(notificationsKey, next);
    },
  });

  if (items.length === 0) return null;
  const unread = items.filter((item) => !item.read).length;
  return (
    <Card asChild>
      <section aria-labelledby="notifications-heading">
        <CardHeader>
          <CardTitle id="notifications-heading">
            {translate(locale, "notifications.title")}
            {unread > 0 ? ` (${unread})` : ""}
          </CardTitle>
          {unread > 0 ? (
            <CardAction>
              <Button onClick={() => markAll.mutate()} size="sm" type="button" variant="ghost">
                {translate(locale, "notifications.markRead")}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <ul className="m-0 grid list-none divide-y p-0">
            {items.map((item) => (
              <li
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                key={item.id}
              >
                <div className="min-w-0">
                  <strong>{translate(locale, `notifications.${item.template}`)}</strong>
                  {item.eventTitle ? ` · ${item.eventTitle}` : ""}
                  <br />
                  <small className="text-sm text-muted-foreground">
                    {formatDateTime(locale, item.createdAt, "Europe/Stockholm")}
                  </small>
                </div>
                {item.read ? null : (
                  <Badge variant="secondary">{translate(locale, "notifications.new")}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </section>
    </Card>
  );
}
