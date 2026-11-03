import type { IncomingSellerInvite } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function IncomingSellerInvites({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const { data: invites = [] } = useQuery({
    queryKey: accountKey(useExpectedAccountId(), "seller-invites"),
    queryFn: async (): Promise<IncomingSellerInvite[]> => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return [];
      return api.listIncomingSellerInvites(token);
    },
    // Session problems are reported by the dashboard.
    throwOnError: false,
  });

  if (invites.length === 0) return null;
  return (
    <Card asChild>
      <section aria-labelledby="seller-invites-heading">
        <CardHeader>
          <CardTitle id="seller-invites-heading">
            {translate(locale, "sellerInvite.incomingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="m-0 grid list-none divide-y p-0">
            {invites.map((invite) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-4 first:pt-0 last:pb-0"
                key={invite.id}
              >
                <strong className="min-w-0 basis-full sm:basis-auto">{invite.eventTitle}</strong>
                <span className="text-sm text-muted-foreground">{invite.organizerDisplayName}</span>
                <Link
                  className="font-semibold sm:ml-auto"
                  params={{ eventId: invite.eventId }}
                  search={{ invite: invite.id }}
                  to="/events/$eventId/join"
                >
                  {translate(locale, "sellerInvite.respond")}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </section>
    </Card>
  );
}
