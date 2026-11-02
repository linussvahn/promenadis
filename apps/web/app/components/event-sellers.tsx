import { PromenadisApiError } from "@promenadis/api-client";
import type {
  DraftEventSummary,
  EventSellers as EventSellersData,
  LocationReviewRequest,
  ModerateParticipationRequest,
  PinCorrectionRequest,
  SellerListing,
  SellerParticipation,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { EventCases } from "./event-cases";
import { EventTaxonomyEditor } from "./event-taxonomy-editor";

const errorKeys = {
  conflict_of_interest: "sellers.ownApplication",
  correction_too_large: "sellers.correctionTooLarge",
  recent_auth_required: "sellers.recentAuth",
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

      <EventCases
        call={call}
        eventId={event.id}
        locale={locale}
        onChanged={load}
        timezone={event.timezone}
      />

      <EventTaxonomyEditor
        call={call}
        editable={canManage && event.state === "draft"}
        eventId={event.id}
        locale={locale}
      />

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
              {seller.location ? (
                <LocationTools
                  busy={busy}
                  canReview={canManage}
                  locale={locale}
                  location={seller.location}
                  otherLocations={data.sellers.flatMap((other) =>
                    other.location &&
                    other.location.id !== seller.location?.id &&
                    other.location.addressLine.toLowerCase() ===
                      seller.location?.addressLine.toLowerCase()
                      ? [other.location]
                      : [],
                  )}
                  onCorrect={(input) =>
                    run(({ api, token }) =>
                      api.correctLocationPin(token, seller.location?.id ?? "", input),
                    )
                  }
                  onReview={(input) =>
                    run(({ api, token }) => api.reviewEventLocation(token, event.id, input))
                  }
                  participationId={seller.id}
                />
              ) : null}
              <p className="field-help">
                {translate(locale, "sellers.appliedAt")}{" "}
                {formatDateTime(locale, seller.appliedAt, event.timezone)}
              </p>
              <SellerListingView
                call={call}
                eventActive={event.state === "active"}
                locale={locale}
                onChanged={load}
                participation={seller}
              />
              {open || holding ? (
                <form className="details-form" onSubmit={(formEvent) => decide(seller, formEvent)}>
                  <label htmlFor={`seller-reason-${seller.id}`}>
                    {translate(locale, "sellers.reason")}
                  </label>
                  <textarea id={`seller-reason-${seller.id}`} maxLength={500} name="reason" />
                  <div className="form-actions">
                    {open || seller.state === "pending_address_change" ? (
                      <button
                        className="primary-button"
                        disabled={busy}
                        type="submit"
                        value="approve"
                      >
                        {translate(locale, open ? "sellers.approve" : "sellers.approveAddress")}
                      </button>
                    ) : null}
                    {open ? (
                      <>
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

function LocationTools({
  busy,
  canReview,
  locale,
  location,
  onCorrect,
  onReview,
  otherLocations,
  participationId,
}: {
  readonly busy: boolean;
  readonly canReview: boolean;
  readonly locale: Locale;
  readonly location: NonNullable<SellerParticipation["location"]>;
  readonly onCorrect: (input: PinCorrectionRequest) => Promise<void>;
  readonly onReview: (input: LocationReviewRequest) => Promise<void>;
  readonly otherLocations: readonly NonNullable<SellerParticipation["location"]>[];
  readonly participationId: string;
}) {
  const prefix = `location-${participationId}`;
  const targets = [...new Map(otherLocations.map((item) => [item.id, item])).values()];
  return (
    <div className="location-tools">
      <p className="field-help">
        {location.sellerCount > 1
          ? translate(locale, "sellers.sharedStop").replace("{count}", String(location.sellerCount))
          : translate(locale, "sellers.ownStop")}
        {" · "}
        {translate(locale, `placement.${location.placement}`)}
      </p>
      {location.needsReview ? (
        <p className="notice">{translate(locale, "sellers.needsReview")}</p>
      ) : null}
      {canReview && location.needsReview ? (
        <div className="form-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void onReview({ action: "confirm_separate", locationId: location.id })}
            type="button"
          >
            {translate(locale, "sellers.confirmSeparate")}
          </button>
          {targets.map((target) => (
            <button
              className="secondary-button"
              disabled={busy}
              key={target.id}
              onClick={() =>
                void onReview({
                  action: "merge",
                  locationId: location.id,
                  targetLocationId: target.id,
                })
              }
              type="button"
            >
              {translate(locale, "sellers.mergeInto")}
            </button>
          ))}
        </div>
      ) : null}
      {canReview && location.sellerCount > 1 ? (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void onReview({ action: "split", locationId: location.id, participationId })
          }
          type="button"
        >
          {translate(locale, "sellers.split")}
        </button>
      ) : null}
      <details className="settings-details">
        <summary>{translate(locale, "sellers.correctPin")}</summary>
        <form
          className="details-form"
          onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
            formEvent.preventDefault();
            const form = new FormData(formEvent.currentTarget);
            void onCorrect({
              latitude: Number(form.get("latitude")),
              longitude: Number(form.get("longitude")),
              reason: String(form.get("reason") ?? ""),
            });
          }}
        >
          <p className="field-help">{translate(locale, "sellers.correctPinHelp")}</p>
          <label htmlFor={`${prefix}-latitude`}>{translate(locale, "boundary.latitude")}</label>
          <input
            defaultValue={location.latitude}
            id={`${prefix}-latitude`}
            inputMode="decimal"
            name="latitude"
            required
          />
          <label htmlFor={`${prefix}-longitude`}>{translate(locale, "boundary.longitude")}</label>
          <input
            defaultValue={location.longitude}
            id={`${prefix}-longitude`}
            inputMode="decimal"
            name="longitude"
            required
          />
          <label htmlFor={`${prefix}-reason`}>
            {translate(locale, "sellers.correctionReason")}
          </label>
          <textarea id={`${prefix}-reason`} maxLength={500} minLength={3} name="reason" required />
          <button className="secondary-button" disabled={busy} type="submit">
            {translate(locale, "sellers.saveCorrection")}
          </button>
        </form>
      </details>
    </div>
  );
}

function SellerListingView({
  call,
  eventActive,
  locale,
  onChanged,
  participation,
}: {
  readonly call: () => Promise<{
    api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
    token: string;
  } | null>;
  readonly eventActive: boolean;
  readonly locale: Locale;
  readonly onChanged: () => Promise<void>;
  readonly participation: SellerParticipation;
}) {
  const [listing, setListing] = useState<SellerListing | null>(null);
  const [status, setStatus] = useState("");

  const load = async () => {
    if (listing) return;
    const client = await call();
    if (!client) return;
    try {
      setListing(await client.api.getSellerListing(client.token, participation.id));
    } catch {
      setStatus(translate(locale, "listing.loadFailed"));
    }
  };

  const moderate = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const [action, itemId] = (submitter?.value ?? "").split(":");
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    const client = await call();
    if (!client || !action) return;
    try {
      await client.api.moderateParticipation(client.token, participation.id, {
        action: action as ModerateParticipationRequest["action"],
        itemId: itemId ?? null,
        reason,
      });
      setListing(await client.api.getSellerListing(client.token, participation.id));
      await onChanged();
      form.reset();
      setStatus(translate(locale, "moderation.done"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "platform_restricted"
            ? "cases.platformRestricted"
            : code === "invalid_request"
              ? "cases.reasonRequired"
              : "listing.error",
        ),
      );
    }
  };

  const onBehalf = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const next = (submitter?.value ?? "open") as "open" | "away" | "closed_early";
    const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "").trim();
    const client = await call();
    if (!client) return;
    try {
      setListing(
        await client.api.setSellerLiveStatus(client.token, participation.id, {
          reason,
          status: next,
          until: null,
        }),
      );
      setStatus(translate(locale, `live.${next}`));
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "reason_required"
            ? "live.reasonRequired"
            : "listing.error",
        ),
      );
    }
  };

  return (
    <details
      className="settings-details"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>{translate(locale, "listing.view")}</summary>
      {listing ? (
        <div>
          {listing.version === 0 ? <p>{translate(locale, "listing.empty")}</p> : null}
          {listing.title ? (
            <p>
              <strong>{listing.title}</strong>
            </p>
          ) : null}
          {listing.description ? <p>{listing.description}</p> : null}
          {listing.tags.length ? <p>{listing.tags.join(" · ")}</p> : null}
          {listing.items.length ? (
            <ul>
              {listing.items.map((item) => (
                <li key={item.id}>
                  {item.name}
                  {item.priceMinor !== null ? ` · ${item.priceMinor / 100} ${item.currency}` : ""}
                  {item.status === "sold" ? ` · ${translate(locale, "listing.sold")}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="field-help">
            {listing.liveStatus
              ? translate(locale, `live.${listing.liveStatus.status}`)
              : translate(locale, "live.scheduled")}
          </p>
          {listing.hidden ? (
            <p className="notice">{translate(locale, "moderation.listingHidden")}</p>
          ) : null}
          <form className="details-form" onSubmit={moderate}>
            <label htmlFor={`moderation-reason-${participation.id}`}>
              {translate(locale, "moderation.reason")}
            </label>
            <textarea
              id={`moderation-reason-${participation.id}`}
              maxLength={500}
              name="reason"
              required
            />
            <div className="form-actions">
              {listing.version > 0 ? (
                <button
                  className="secondary-button"
                  type="submit"
                  value={listing.hidden ? "restore_listing" : "hide_listing"}
                >
                  {translate(
                    locale,
                    listing.hidden ? "moderation.restoreListing" : "moderation.hideListing",
                  )}
                </button>
              ) : null}
              {listing.items.map((item) => (
                <button
                  className="secondary-button"
                  key={item.id}
                  type="submit"
                  value={`${item.hidden ? "restore_item" : "hide_item"}:${item.id}`}
                >
                  {translate(
                    locale,
                    item.hidden ? "moderation.restoreItem" : "moderation.hideItem",
                  )}
                  : {item.name}
                </button>
              ))}
              {participation.state === "approved" ? (
                <button className="danger-button" type="submit" value="suspend">
                  {translate(locale, "moderation.suspend")}
                </button>
              ) : null}
              {participation.state === "suspended" ? (
                <button className="secondary-button" type="submit" value="reinstate">
                  {translate(locale, "moderation.reinstate")}
                </button>
              ) : null}
            </div>
          </form>
          {eventActive && participation.state === "approved" ? (
            <form className="details-form" onSubmit={onBehalf}>
              <label htmlFor={`live-reason-${participation.id}`}>
                {translate(locale, "live.onBehalfReason")}
              </label>
              <textarea id={`live-reason-${participation.id}`} maxLength={500} name="reason" />
              <div className="form-actions">
                {(["open", "away", "closed_early"] as const).map((next) => (
                  <button className="secondary-button" key={next} type="submit" value={next}>
                    {translate(locale, `live.set.${next}`)}
                  </button>
                ))}
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </details>
  );
}
