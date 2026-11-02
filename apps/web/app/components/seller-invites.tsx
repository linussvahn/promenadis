import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { SellerInvite } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;

// Owner/co-host invitations by email. They never reserve a seller place.
export function SellerInvites({
  call,
  eventId,
  locale,
  timezone,
}: {
  readonly call: () => Promise<{ api: ApiClient; token: string } | null>;
  readonly eventId: string;
  readonly locale: Locale;
  readonly timezone: string;
}) {
  const [invites, setInvites] = useState<SellerInvite[] | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void (async () => {
      const client = await call();
      if (!client) return;
      try {
        setInvites(await client.api.listSellerInvites(client.token, eventId));
      } catch {
        setInvites(null);
      }
    })();
  }, [call, eventId]);

  const invite = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    const client = await call();
    if (!client) return;
    try {
      setInvites(await client.api.inviteSeller(client.token, eventId, email));
      form.reset();
      setStatus(translate(locale, "sellerInvite.sent"));
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "invalid_state"
            ? "sellerInvite.closed"
            : "sellerInvite.error",
        ),
      );
    }
  };

  const cancel = async (id: string) => {
    const client = await call();
    if (!client) return;
    try {
      setInvites(await client.api.cancelSellerInvite(client.token, id));
    } catch {
      setStatus(translate(locale, "sellerInvite.error"));
    }
  };

  if (!invites) return null;
  return (
    <section aria-labelledby="seller-invite-heading" className="panel">
      <h2 id="seller-invite-heading">{translate(locale, "sellerInvite.title")}</h2>
      <p className="field-help">{translate(locale, "sellerInvite.help")}</p>
      <form className="inline-control" onSubmit={invite}>
        <label className="visually-hidden" htmlFor="seller-invite-email">
          {translate(locale, "sellerInvite.email")}
        </label>
        <input
          autoComplete="off"
          id="seller-invite-email"
          name="email"
          placeholder={translate(locale, "sellerInvite.email")}
          required
          type="email"
        />
        <button className="secondary-button" type="submit">
          {translate(locale, "sellerInvite.send")}
        </button>
      </form>
      <ul className="resource-list">
        {invites.map((item) => (
          <li key={item.id}>
            <span>{item.email}</span>
            <span className="field-help">
              {translate(locale, "sellerInvite.expires")}{" "}
              {formatDateTime(locale, item.expiresAt, timezone)}
            </span>
            <button className="text-button" onClick={() => void cancel(item.id)} type="button">
              {translate(locale, "sellerInvite.cancel")}
            </button>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
