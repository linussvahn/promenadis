import { PromenadisApiError } from "@promenadis/api-client";
import type {
  DraftEventSummary,
  EventSellers as EventSellersData,
  SellerParticipation,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";

const errorKeys = {
  conflict_of_interest: "sellers.ownApplication",
  places_full: "sellers.placesFull",
  version_conflict: "sellers.changed",
} as const;

const stateOrder = [
  "pending",
  "waitlisted",
  "approved",
  "pending_address_change",
  "suspended",
  "pending_reschedule_confirmation",
  "withdrawn",
  "rejected",
  "revoked",
] as const;

// Event-team view: seller places, admission settings and decisions.
export function EventSellers({
  accessToken,
  event,
  locale,
  onChanged,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<EventSellersData | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const canManage = event.role === "owner" || event.role === "co_host";

  const call = useCallback(async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  }, [accessToken]);

  const load = useCallback(async () => {
    const client = await call();
    if (!client) return;
    try {
      setData(await client.api.listEventSellers(client.token, event.id));
    } catch {
      setStatus(translate(locale, "sellers.error"));
    }
  }, [call, event.id, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    action: (client: NonNullable<Awaited<ReturnType<typeof call>>>) => Promise<unknown>,
  ) => {
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await action(client);
      await load();
      setStatus(translate(locale, "sellers.saved"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(translate(locale, errorKeys[code as keyof typeof errorKeys] ?? "sellers.error"));
    } finally {
      setBusy(false);
    }
  };

  const saveAdmission = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    void run(async ({ api, token }) => {
      await api.updateEventAdmission(token, event.id, {
        admissionMode: String(form.get("admissionMode")) as EventSellersData["admissionMode"],
        expectedVersion: event.version,
        waitlistPromotionPaused: form.get("promotionPaused") === "on",
      });
      await onChanged();
    });
  };

  const decide = (seller: SellerParticipation, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = (submitter?.value ?? "approve") as
      | "approve"
      | "waitlist"
      | "reject"
      | "revoke";
    const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "").trim();
    void run(({ api, token }) =>
      api.decideSeller(token, seller.id, {
        decision,
        expectedVersion: seller.version,
        ...(reason ? { reason } : {}),
      }),
    );
  };

  if (!data) {
    return <p aria-live="polite">{status || translate(locale, "common.loading")}</p>;
  }

  const sellers = [...data.sellers].sort(
    (a, b) => stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state),
  );
  const joinUrl =
    typeof window === "undefined"
      ? `/events/${event.id}/join`
      : `${window.location.origin}/events/${event.id}/join`;

  return (
    <div className="event-sellers">
      <section aria-labelledby="places-heading" className="panel">
        <h2 id="places-heading">{translate(locale, "sellers.places")}</h2>
        <p className="capacity-summary">
          {translate(locale, "sellers.capacity")
            .replace("{used}", String(data.placesUsed))
            .replace("{limit}", String(data.sellerLimit))
            .replace("{locations}", String(data.locationCount))}
        </p>
        <label htmlFor="seller-join-link">{translate(locale, "sellers.joinLink")}</label>
        <input id="seller-join-link" readOnly value={joinUrl} />
        <p className="field-help">{translate(locale, "sellers.joinLinkHelp")}</p>
      </section>

      {canManage && (event.state === "draft" || event.state === "published") ? (
        <form className="panel form-panel" key={data.eventVersion} onSubmit={saveAdmission}>
          <h2>{translate(locale, "sellers.admission")}</h2>
          <fieldset className="choice-group">
            <legend>{translate(locale, "sellers.admissionMode")}</legend>
            {(["auto_inside", "host_approval", "invite_only"] as const).map((mode) => (
              <label className="checkbox-field" key={mode}>
                <input
                  defaultChecked={data.admissionMode === mode}
                  name="admissionMode"
                  type="radio"
                  value={mode}
                />
                <span>{translate(locale, `admission.${mode}`)}</span>
              </label>
            ))}
          </fieldset>
          <label className="checkbox-field">
            <input
              defaultChecked={data.waitlistPromotionPaused}
              name="promotionPaused"
              type="checkbox"
            />
            <span>{translate(locale, "sellers.promotionPaused")}</span>
          </label>
          <button className="secondary-button" disabled={busy} type="submit">
            {translate(locale, "sellers.saveAdmission")}
          </button>
        </form>
      ) : null}

      <section aria-labelledby="applications-heading" className="panel">
        <h2 id="applications-heading">{translate(locale, "sellers.applications")}</h2>
        {sellers.length === 0 ? <p>{translate(locale, "sellers.empty")}</p> : null}
        {sellers.map((seller) => {
          const open = ["pending", "waitlisted"].includes(seller.state);
          const holding = ["approved", "suspended", "pending_address_change"].includes(
            seller.state,
          );
          return (
            <article className="review-item" key={seller.id}>
              <h3>{seller.displayName}</h3>
              <p>
                <span className="status-pill status-pill-muted">
                  {translate(locale, `participation.${seller.state}`)}
                </span>{" "}
                {seller.geographicException ? translate(locale, "sellers.outside") : null}
              </p>
              {seller.location ? (
                <p>
                  {seller.location.addressLine}
                  {seller.location.postalCode ? `, ${seller.location.postalCode}` : ""}
                  {seller.location.locality ? ` ${seller.location.locality}` : ""}
                </p>
              ) : null}
              <p className="field-help">
                {translate(locale, "sellers.appliedAt")}{" "}
                {formatDateTime(locale, seller.appliedAt, event.timezone)}
              </p>
              {open || holding ? (
                <form className="details-form" onSubmit={(formEvent) => decide(seller, formEvent)}>
                  <label htmlFor={`seller-reason-${seller.id}`}>
                    {translate(locale, "sellers.reason")}
                  </label>
                  <textarea id={`seller-reason-${seller.id}`} maxLength={500} name="reason" />
                  <div className="form-actions">
                    {open ? (
                      <>
                        <button
                          className="primary-button"
                          disabled={busy}
                          type="submit"
                          value="approve"
                        >
                          {translate(locale, "sellers.approve")}
                        </button>
                        {seller.state === "pending" ? (
                          <button
                            className="secondary-button"
                            disabled={busy}
                            type="submit"
                            value="waitlist"
                          >
                            {translate(locale, "sellers.waitlist")}
                          </button>
                        ) : null}
                        <button
                          className="danger-button"
                          disabled={busy}
                          type="submit"
                          value="reject"
                        >
                          {translate(locale, "sellers.reject")}
                        </button>
                      </>
                    ) : (
                      <button
                        className="danger-button"
                        disabled={busy}
                        type="submit"
                        value="revoke"
                      >
                        {translate(locale, "sellers.revoke")}
                      </button>
                    )}
                  </div>
                </form>
              ) : null}
            </article>
          );
        })}
      </section>
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </div>
  );
}
