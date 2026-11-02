import { PromenadisApiError } from "@promenadis/api-client";
import type { EventForSeller } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { SellerAddressForm, type SellerAddressInput } from "./seller-address-form";
import { SellerListingEditor } from "./seller-listing-editor";

export function SellerJoin() {
  return <AccountShell>{({ locale }) => <SellerJoinContent locale={locale} />}</AccountShell>;
}

const errorKeys = {
  already_applied: "seller.alreadyApplied",
  area_not_ready: "seller.areaNotReady",
  invite_only: "seller.inviteOnly",
  rate_limited: "seller.rateLimited",
  registration_closed: "seller.closed",
  version_conflict: "seller.changed",
} as const;

export function SellerJoinContent({ locale }: { readonly locale: Locale }) {
  const { eventId = "" } = useParams();
  const { accessToken, dashboard } = useAccountData();
  const [event, setEvent] = useState<EventForSeller | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const call = useCallback(async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  }, [accessToken]);

  const load = useCallback(async () => {
    const client = await call();
    if (!client) return;
    try {
      setEvent(await client.api.getEventForSeller(client.token, eventId));
    } catch {
      setFailed(true);
    }
  }, [call, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const errorText = (error: unknown) => {
    const code = error instanceof PromenadisApiError ? error.code : "";
    return translate(locale, errorKeys[code as keyof typeof errorKeys] ?? "seller.error");
  };

  const apply = async (input: SellerAddressInput, form: FormData) => {
    const client = await call();
    if (!client) return;
    await client.api.applyToEvent(client.token, eventId, {
      ...input,
      displayName: String(form.get("displayName") ?? ""),
    });
    await load();
  };

  const changeAddress = async (input: SellerAddressInput) => {
    const participation = event?.participation;
    const client = await call();
    if (!participation || !client) return;
    await client.api.changeParticipationAddress(client.token, participation.id, {
      ...input,
      expectedVersion: participation.version,
    });
    await load();
    setStatus(translate(locale, "seller.addressChanged"));
  };

  const withdraw = async () => {
    const participation = event?.participation;
    const client = await call();
    if (!participation || !client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.withdrawParticipation(client.token, participation.id, participation.version);
      await load();
      setStatus(translate(locale, "seller.withdrawn"));
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <main className="account-page flow-page" id="main">
        <p className="notice notice-error" role="alert">
          {translate(locale, "seller.notFound")}
        </p>
      </main>
    );
  }
  if (!event) {
    return (
      <main className="account-page flow-page" id="main">
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      </main>
    );
  }

  const participation = event.participation;
  const closed = participation
    ? ["withdrawn", "rejected", "revoked"].includes(participation.state)
    : false;

  return (
    <main className="account-page flow-page" id="main" tabIndex={-1}>
      <Link className="back-link" to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <header className="app-heading flow-heading">
        <p className="eyebrow">{translate(locale, "seller.eyebrow")}</p>
        <h1>{event.title}</h1>
        <p className="lede">
          {event.organizerDisplayName}
          {event.startsAt ? ` · ${formatDateTime(locale, event.startsAt, event.timezone)}` : null}
        </p>
        {event.description ? <p>{event.description}</p> : null}
      </header>

      {participation ? (
        <section aria-labelledby="participation-heading" className="panel">
          <h2 id="participation-heading">{translate(locale, "seller.yourApplication")}</h2>
          <p>
            <span className="status-pill status-pill-muted">
              {translate(locale, `participation.${participation.state}`)}
            </span>
          </p>
          <p>{translate(locale, `participation.${participation.state}.help`)}</p>
          {participation.decisionReason ? (
            <p>
              {translate(locale, "seller.reason")}: {participation.decisionReason}
            </p>
          ) : null}
          {participation.location ? (
            <dl className="summary-list">
              <div>
                <dt>{translate(locale, "seller.address")}</dt>
                <dd>
                  {participation.location.addressLine}
                  {participation.location.postalCode
                    ? `, ${participation.location.postalCode}`
                    : ""}
                  {participation.location.locality ? ` ${participation.location.locality}` : ""}
                </dd>
              </div>
              <div>
                <dt>{translate(locale, "seller.publicName")}</dt>
                <dd>{participation.displayName}</dd>
              </div>
            </dl>
          ) : null}
          {participation.geographicException && !closed ? (
            <p className="field-help">{translate(locale, "seller.outsideHelp")}</p>
          ) : null}
          {participation.location?.sellerCount && participation.location.sellerCount > 1 ? (
            <p className="field-help">{translate(locale, "seller.sharedStop")}</p>
          ) : null}
          {!closed &&
          ["pending", "waitlisted", "approved", "pending_address_change"].includes(
            participation.state,
          ) &&
          ["draft", "published", "active"].includes(event.state) ? (
            <details className="settings-details">
              <summary>{translate(locale, "seller.changeAddress")}</summary>
              <p className="field-help">
                {translate(
                  locale,
                  ["approved", "pending_address_change"].includes(participation.state)
                    ? "seller.changeAddressReview"
                    : "seller.changeAddressHelp",
                )}
              </p>
              <SellerAddressForm
                call={call}
                eventBoundary={event.boundary}
                eventId={eventId}
                idPrefix="change"
                initial={participation.location}
                key={participation.version}
                locale={locale}
                onSubmit={changeAddress}
                submitLabel={translate(locale, "seller.saveAddress")}
              />
            </details>
          ) : null}
          {!closed ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void withdraw()}
              type="button"
            >
              {translate(locale, "seller.withdraw")}
            </button>
          ) : null}
        </section>
      ) : null}
      {participation && !closed && !["ended", "cancelled", "archived"].includes(event.state) ? (
        <SellerListingEditor
          call={call}
          eventActive={event.state === "active"}
          eventEndsAt={event.endsAt}
          eventId={eventId}
          eventStartsAt={event.startsAt}
          locale={locale}
          participation={participation}
          timezone={event.timezone}
        />
      ) : null}
      {participation ? null : event.registrationOpen ? (
        <section aria-labelledby="apply-heading" className="panel">
          <h2 id="apply-heading">{translate(locale, "seller.applyTitle")}</h2>
          <p>{translate(locale, "seller.applyIntro")}</p>
          {event.placesFull ? (
            <p className="notice">{translate(locale, "seller.placesFull")}</p>
          ) : null}
          <SellerAddressForm
            call={call}
            eventBoundary={event.boundary}
            eventId={eventId}
            idPrefix="seller"
            locale={locale}
            onSubmit={apply}
            submitLabel={translate(locale, "seller.submit")}
          >
            <label htmlFor="seller-display-name">{translate(locale, "seller.publicName")}</label>
            <input
              aria-describedby="seller-display-name-help"
              defaultValue={dashboard?.profile.displayName ?? ""}
              id="seller-display-name"
              maxLength={80}
              name="displayName"
              required
            />
            <p className="field-help" id="seller-display-name-help">
              {translate(locale, "seller.publicNameHelp")}
            </p>
          </SellerAddressForm>
        </section>
      ) : (
        <p className="notice">
          {translate(
            locale,
            event.admissionMode === "invite_only" ? "seller.inviteOnly" : "seller.closed",
          )}
        </p>
      )}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </main>
  );
}
