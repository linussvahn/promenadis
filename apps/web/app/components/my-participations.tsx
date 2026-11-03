import type { MyParticipation } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
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
  const { data: items = [] } = useQuery({
    queryKey: accountKey(useExpectedAccountId(), "participations"),
    queryFn: async (): Promise<MyParticipation[]> => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return [];
      return api.listMyParticipations(token);
    },
    // The events list above already reports session problems.
    throwOnError: false,
  });

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
                <Link
                  className="font-semibold sm:ml-auto"
                  params={{ eventId: item.eventId }}
                  to="/events/$eventId/join"
                >
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
