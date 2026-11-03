import type { MyParticipation } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

// The signed-in account's seller applications, newest first.
export function MyParticipations({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const [items, setItems] = useState<MyParticipation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      try {
        const next = await api.listMyParticipations(token);
        if (!cancelled) setItems(next);
      } catch {
        // The events list above already reports session problems.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (items.length === 0) return null;

  return (
    <Card asChild>
      <section aria-labelledby="my-participations-heading">
        <CardHeader>
          <CardTitle id="my-participations-heading">
            {translate(locale, "seller.myApplications")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="m-0 grid list-none divide-y p-0">
            {items.map((item) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-4 first:pt-0 last:pb-0"
                key={item.id}
              >
                <strong className="min-w-0 basis-full sm:basis-auto">{item.eventTitle}</strong>
                <Badge variant="secondary">
                  {translate(locale, `participation.${item.state}`)}
                </Badge>
                {item.startsAt ? (
                  <span className="text-sm text-muted-foreground">
                    {formatDateTime(locale, item.startsAt, item.timezone)}
                  </span>
                ) : null}
                <Link className="font-semibold sm:ml-auto" to={`/events/${item.eventId}/join`}>
                  {translate(locale, "seller.openApplication")}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </section>
    </Card>
  );
}
