import type { AccountNotifications } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
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
  const [items, setItems] = useState<AccountNotifications>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      try {
        const next = await api.listNotifications(token);
        if (!cancelled) setItems(next);
      } catch {
        // The events list above already reports session problems.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const markAll = async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    try {
      setItems(await api.markNotificationsRead(token));
    } catch {
      // Unread state is cosmetic; keep the list as it is.
    }
  };

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
              <Button onClick={() => void markAll()} size="sm" type="button" variant="ghost">
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
