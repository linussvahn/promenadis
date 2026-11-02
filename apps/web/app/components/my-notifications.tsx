import type { AccountNotifications } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";

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
    <section aria-labelledby="notifications-heading" className="panel">
      <h2 id="notifications-heading">
        {translate(locale, "notifications.title")}
        {unread > 0 ? ` (${unread})` : ""}
      </h2>
      <ul className="stop-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{translate(locale, `notifications.${item.template}`)}</strong>
            {item.eventTitle ? ` · ${item.eventTitle}` : ""}
            <br />
            <small>{formatDateTime(locale, item.createdAt, "Europe/Stockholm")}</small>
            {item.read ? null : (
              <span className="status-pill status-pill-muted">
                {translate(locale, "notifications.new")}
              </span>
            )}
          </li>
        ))}
      </ul>
      {unread > 0 ? (
        <button className="quiet-button" onClick={() => void markAll()} type="button">
          {translate(locale, "notifications.markRead")}
        </button>
      ) : null}
    </section>
  );
}
