import type { IncomingSellerInvite } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";

export function IncomingSellerInvites({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const [invites, setInvites] = useState<IncomingSellerInvite[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      try {
        const next = await api.listIncomingSellerInvites(token);
        if (!cancelled) setInvites(next);
      } catch {
        // Session problems are reported by the dashboard.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (invites.length === 0) return null;
  return (
    <section aria-labelledby="seller-invites-heading" className="panel">
      <h2 id="seller-invites-heading">{translate(locale, "sellerInvite.incomingTitle")}</h2>
      <ul className="resource-list">
        {invites.map((invite) => (
          <li key={invite.id}>
            <strong>{invite.eventTitle}</strong>
            <span>{invite.organizerDisplayName}</span>
            <Link className="text-link" to={`/events/${invite.eventId}/join?invite=${invite.id}`}>
              {translate(locale, "sellerInvite.respond")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
