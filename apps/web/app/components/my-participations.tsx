import type { MyParticipation } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";

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
    <section aria-labelledby="my-participations-heading" className="panel">
      <h2 id="my-participations-heading">{translate(locale, "seller.myApplications")}</h2>
      <ul className="resource-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.eventTitle}</strong>
            <span className="status-pill status-pill-muted">
              {translate(locale, `participation.${item.state}`)}
            </span>
            {item.startsAt ? (
              <span>{formatDateTime(locale, item.startsAt, item.timezone)}</span>
            ) : null}
            <Link className="text-link" to={`/events/${item.eventId}/join`}>
              {translate(locale, "seller.openApplication")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
