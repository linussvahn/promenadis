import { PromenadisApiError } from "@promenadis/api-client";
import type { BoundaryPoint, EventForSeller } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { PinPicker } from "./pin-picker";

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
  const [pin, setPin] = useState<BoundaryPoint | null>(null);
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

  const apply = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    if (!pin) {
      setStatus(translate(locale, "seller.pinRequired"));
      return;
    }
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.applyToEvent(client.token, eventId, {
        addressLine: String(form.get("addressLine") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        latitude: pin[1],
        locality: String(form.get("locality") ?? ""),
        longitude: pin[0],
        postalCode: String(form.get("postalCode") ?? "").trim(),
        rightToUseAttested: true,
      });
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
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
      ) : event.registrationOpen ? (
        <form className="panel form-panel creation-form" onSubmit={apply}>
          <h2>{translate(locale, "seller.applyTitle")}</h2>
          <p>{translate(locale, "seller.applyIntro")}</p>
          {event.placesFull ? (
            <p className="notice">{translate(locale, "seller.placesFull")}</p>
          ) : null}
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
          <label htmlFor="seller-address">{translate(locale, "seller.address")}</label>
          <input
            autoComplete="street-address"
            id="seller-address"
            maxLength={200}
            minLength={3}
            name="addressLine"
            required
          />
          <div className="schedule-fields">
            <div>
              <label htmlFor="seller-postal-code">{translate(locale, "seller.postalCode")}</label>
              <input
                autoComplete="postal-code"
                id="seller-postal-code"
                inputMode="numeric"
                maxLength={6}
                name="postalCode"
                pattern="[0-9]{3} ?[0-9]{2}"
              />
            </div>
            <div>
              <label htmlFor="seller-locality">{translate(locale, "seller.locality")}</label>
              <input
                autoComplete="address-level2"
                id="seller-locality"
                maxLength={100}
                name="locality"
              />
            </div>
          </div>
          <p className="field-help">{translate(locale, "seller.privateAddressHelp")}</p>
          <h3>{translate(locale, "seller.pinTitle")}</h3>
          <p className="field-help">{translate(locale, "seller.pinHelp")}</p>
          <PinPicker boundary={event.boundary} locale={locale} onChange={setPin} value={pin} />
          <label className="checkbox-field">
            <input name="rightToUse" required type="checkbox" />
            <span>{translate(locale, "seller.attestation")}</span>
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? translate(locale, "common.saving") : translate(locale, "seller.submit")}
          </button>
        </form>
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
