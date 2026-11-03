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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { EventCases } from "./event-cases";
import { EventTaxonomyEditor } from "./event-taxonomy-editor";
import { SellerInvites } from "./seller-invites";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Checkbox, Radio } from "./ui/checkbox";
import { ChoiceField, Field, FieldDescription, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const actions = "flex flex-wrap items-center gap-2";
const details =
  "rounded-xl border bg-card px-4 py-3 [&>summary]:flex [&>summary]:min-h-8 [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:text-sm [&>summary]:font-semibold";
const subForm = "mt-3 grid gap-4";

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
  const accountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const canManage = event.role === "owner" || event.role === "co_host";

  const call = useCallback(async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  }, [accessToken]);

  const sellersQuery = useQuery({
    queryKey: accountKey(accountId, "event", event.id, "sellers"),
    queryFn: async () => {
      const client = await call();
      return client ? client.api.listEventSellers(client.token, event.id) : null;
    },
  });
  const data = sellersQuery.data ?? null;

  const load = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: accountKey(accountId, "event", event.id, "sellers"),
      }),
    [accountId, event.id, queryClient],
  );

  const mutation = useMutation({
    mutationFn: async (
      action: (client: NonNullable<Awaited<ReturnType<typeof call>>>) => Promise<unknown>,
    ) => {
      const client = await call();
      if (!client) return false;
      await action(client);
      return true;
    },
    onSuccess: async (done) => {
      if (done) await load();
    },
  });
  const busy = mutation.isPending;

  const run = async (
    action: (client: NonNullable<Awaited<ReturnType<typeof call>>>) => Promise<unknown>,
  ) => {
    setStatus("");
    try {
      if (await mutation.mutateAsync(action)) setStatus(translate(locale, "sellers.saved"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(translate(locale, errorKeys[code as keyof typeof errorKeys] ?? "sellers.error"));
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

  const saveEarly = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const visible = new FormData(formEvent.currentTarget).get("earlyVisible") === "on";
    void run(async ({ api, token }) => {
      await api.setEarlyLocationVisibility(token, event.id, {
        expectedEventVersion: event.version,
        visible,
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
    return (
      <p aria-live="polite">
        {status || translate(locale, sellersQuery.isError ? "sellers.error" : "common.loading")}
      </p>
    );
  }

  const sellers = [...data.sellers].sort(
    (a, b) => stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state),
  );
  const joinUrl =
    typeof window === "undefined"
      ? `/events/${event.id}/join`
      : `${window.location.origin}/events/${event.id}/join`;

  return (
    <div className="grid min-w-0 content-start gap-5">
      <Card asChild>
        <section aria-labelledby="places-heading">
          <CardHeader>
            <CardTitle id="places-heading">{translate(locale, "sellers.places")}</CardTitle>
            <CardDescription className="text-base font-semibold text-foreground">
              {translate(locale, "sellers.capacity")
                .replace("{used}", String(data.placesUsed))
                .replace("{limit}", String(data.sellerLimit))
                .replace("{locations}", String(data.locationCount))}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field>
              <Label htmlFor="seller-join-link">{translate(locale, "sellers.joinLink")}</Label>
              <Input className="bg-muted" id="seller-join-link" readOnly value={joinUrl} />
              <FieldDescription>{translate(locale, "sellers.joinLinkHelp")}</FieldDescription>
            </Field>
          </CardContent>
        </section>
      </Card>

      {canManage ? (
        <SellerInvites call={call} eventId={event.id} locale={locale} timezone={event.timezone} />
      ) : null}

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
        <Card asChild>
          <form key={data.eventVersion} onSubmit={saveAdmission}>
            <CardHeader>
              <CardTitle>{translate(locale, "sellers.admission")}</CardTitle>
            </CardHeader>
            <CardContent className="gap-5">
              <FieldSet>
                <FieldLegend>{translate(locale, "sellers.admissionMode")}</FieldLegend>
                {(["auto_inside", "host_approval", "invite_only"] as const).map((mode) => (
                  <ChoiceField key={mode}>
                    <Radio
                      defaultChecked={data.admissionMode === mode}
                      name="admissionMode"
                      value={mode}
                    />
                    <span>{translate(locale, `admission.${mode}`)}</span>
                  </ChoiceField>
                ))}
              </FieldSet>
              <ChoiceField className="border-t pt-5">
                <Checkbox defaultChecked={data.waitlistPromotionPaused} name="promotionPaused" />
                <span>{translate(locale, "sellers.promotionPaused")}</span>
              </ChoiceField>
            </CardContent>
            <CardFooter>
              <Button disabled={busy} type="submit" variant="outline">
                {translate(locale, "sellers.saveAdmission")}
              </Button>
            </CardFooter>
          </form>
        </Card>
      ) : null}
      {canManage && (event.state === "draft" || event.state === "published") ? (
        <Card asChild>
          <form key={`early-${data.eventVersion}`} onSubmit={saveEarly}>
            <CardHeader>
              <CardTitle>{translate(locale, "sellers.earlyVisibility")}</CardTitle>
            </CardHeader>
            <CardContent className="gap-2">
              <ChoiceField>
                <Checkbox defaultChecked={data.earlyLocationVisibility} name="earlyVisible" />
                <span>{translate(locale, "sellers.earlyVisibilityLabel")}</span>
              </ChoiceField>
              <FieldDescription className="pl-8">
                {translate(locale, "sellers.earlyVisibilityHint")}
              </FieldDescription>
            </CardContent>
            <CardFooter>
              <Button disabled={busy} type="submit" variant="outline">
                {translate(locale, "sellers.saveEarlyVisibility")}
              </Button>
            </CardFooter>
          </form>
        </Card>
      ) : null}

      <Card asChild>
        <section aria-labelledby="applications-heading">
          <CardHeader>
            <CardTitle id="applications-heading">
              {translate(locale, "sellers.applications")}
            </CardTitle>
          </CardHeader>
          <CardContent className="gap-0 divide-y">
            {sellers.length === 0 ? (
              <p className="text-muted-foreground">{translate(locale, "sellers.empty")}</p>
            ) : null}
            {sellers.map((seller) => {
              const open = ["pending", "waitlisted"].includes(seller.state);
              const holding = ["approved", "suspended", "pending_address_change"].includes(
                seller.state,
              );
              return (
                <article className="grid gap-3 py-5 first:pt-0 last:pb-0" key={seller.id}>
                  <div className="grid gap-1.5">
                    <h3 className="text-lg font-bold">{seller.displayName}</h3>
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">
                        {translate(locale, `participation.${seller.state}`)}
                      </Badge>{" "}
                      {seller.geographicException ? translate(locale, "sellers.outside") : null}
                    </p>
                  </div>
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
                  <p className="text-sm text-muted-foreground">
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
                    <form
                      className="grid gap-3 rounded-xl bg-muted/50 p-4"
                      onSubmit={(formEvent) => decide(seller, formEvent)}
                    >
                      <Field>
                        <Label htmlFor={`seller-reason-${seller.id}`}>
                          {translate(locale, "sellers.reason")}
                        </Label>
                        <Textarea
                          className="min-h-20"
                          id={`seller-reason-${seller.id}`}
                          maxLength={500}
                          name="reason"
                        />
                      </Field>
                      <div className={actions}>
                        {open || seller.state === "pending_address_change" ? (
                          <Button disabled={busy} type="submit" value="approve">
                            {translate(locale, open ? "sellers.approve" : "sellers.approveAddress")}
                          </Button>
                        ) : null}
                        {open ? (
                          <>
                            {seller.state === "pending" ? (
                              <Button
                                disabled={busy}
                                type="submit"
                                value="waitlist"
                                variant="outline"
                              >
                                {translate(locale, "sellers.waitlist")}
                              </Button>
                            ) : null}
                            <Button
                              disabled={busy}
                              type="submit"
                              value="reject"
                              variant="destructive"
                            >
                              {translate(locale, "sellers.reject")}
                            </Button>
                          </>
                        ) : (
                          <Button
                            disabled={busy}
                            type="submit"
                            value="revoke"
                            variant="destructive"
                          >
                            {translate(locale, "sellers.revoke")}
                          </Button>
                        )}
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </CardContent>
        </section>
      </Card>
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
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
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {location.sellerCount > 1
          ? translate(locale, "sellers.sharedStop").replace("{count}", String(location.sellerCount))
          : translate(locale, "sellers.ownStop")}
        {" · "}
        {translate(locale, `placement.${location.placement}`)}
      </p>
      {location.needsReview ? (
        <Alert variant="warning">{translate(locale, "sellers.needsReview")}</Alert>
      ) : null}
      {canReview && location.needsReview ? (
        <div className={actions}>
          <Button
            disabled={busy}
            onClick={() => void onReview({ action: "confirm_separate", locationId: location.id })}
            size="sm"
            type="button"
            variant="outline"
          >
            {translate(locale, "sellers.confirmSeparate")}
          </Button>
          {targets.map((target) => (
            <Button
              disabled={busy}
              key={target.id}
              onClick={() =>
                void onReview({
                  action: "merge",
                  locationId: location.id,
                  targetLocationId: target.id,
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {translate(locale, "sellers.mergeInto")}
            </Button>
          ))}
        </div>
      ) : null}
      {canReview && location.sellerCount > 1 ? (
        <div>
          <Button
            disabled={busy}
            onClick={() =>
              void onReview({ action: "split", locationId: location.id, participationId })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {translate(locale, "sellers.split")}
          </Button>
        </div>
      ) : null}
      <details className={details}>
        <summary>{translate(locale, "sellers.correctPin")}</summary>
        <form
          className={subForm}
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
          <FieldDescription>{translate(locale, "sellers.correctPinHelp")}</FieldDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor={`${prefix}-latitude`}>{translate(locale, "boundary.latitude")}</Label>
              <Input
                defaultValue={location.latitude}
                id={`${prefix}-latitude`}
                inputMode="decimal"
                name="latitude"
                required
              />
            </Field>
            <Field>
              <Label htmlFor={`${prefix}-longitude`}>
                {translate(locale, "boundary.longitude")}
              </Label>
              <Input
                defaultValue={location.longitude}
                id={`${prefix}-longitude`}
                inputMode="decimal"
                name="longitude"
                required
              />
            </Field>
          </div>
          <Field>
            <Label htmlFor={`${prefix}-reason`}>
              {translate(locale, "sellers.correctionReason")}
            </Label>
            <Textarea
              className="min-h-20"
              id={`${prefix}-reason`}
              maxLength={500}
              minLength={3}
              name="reason"
              required
            />
          </Field>
          <div>
            <Button disabled={busy} type="submit" variant="outline">
              {translate(locale, "sellers.saveCorrection")}
            </Button>
          </div>
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
  const accountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState("");
  const listingKey = accountKey(accountId, "participation", participation.id, "listing");

  const listingQuery = useQuery({
    enabled: opened,
    queryKey: listingKey,
    queryFn: async () => {
      const client = await call();
      return client ? client.api.getSellerListing(client.token, participation.id) : null;
    },
  });
  const listing: SellerListing | null = listingQuery.data ?? null;
  const loadFailed = listingQuery.isError && !listing;

  const moderation = useMutation({
    mutationFn: async (input: ModerateParticipationRequest) => {
      const client = await call();
      if (!client) return false;
      await client.api.moderateParticipation(client.token, participation.id, input);
      return true;
    },
    onSuccess: async (done) => {
      if (!done) return;
      await queryClient.invalidateQueries({ queryKey: listingKey });
      await onChanged();
    },
  });

  const liveStatus = useMutation({
    mutationFn: async (input: { reason: string; status: "open" | "away" | "closed_early" }) => {
      const client = await call();
      if (!client) return null;
      return client.api.setSellerLiveStatus(client.token, participation.id, {
        reason: input.reason,
        status: input.status,
        until: null,
      });
    },
    onSuccess: (next) => {
      if (next) queryClient.setQueryData(listingKey, next);
    },
  });

  const moderate = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const [action, itemId] = (submitter?.value ?? "").split(":");
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    if (!action) return;
    try {
      const done = await moderation.mutateAsync({
        action: action as ModerateParticipationRequest["action"],
        itemId: itemId ?? null,
        reason,
      });
      if (!done) return;
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
    try {
      if (await liveStatus.mutateAsync({ reason, status: next })) {
        setStatus(translate(locale, `live.${next}`));
      }
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
      className={details}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>{translate(locale, "listing.view")}</summary>
      {listing ? (
        <div className="mt-3 grid gap-3 text-sm">
          {listing.version === 0 ? (
            <p className="text-muted-foreground">{translate(locale, "listing.empty")}</p>
          ) : null}
          {listing.title ? (
            <p className="text-base">
              <strong>{listing.title}</strong>
            </p>
          ) : null}
          {listing.description ? <p className="leading-relaxed">{listing.description}</p> : null}
          {listing.tags.length ? (
            <p className="text-muted-foreground">{listing.tags.join(" · ")}</p>
          ) : null}
          {listing.items.length ? (
            <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
              {listing.items.map((item) => (
                <li className="px-3 py-2" key={item.id}>
                  {item.name}
                  {item.priceMinor !== null ? ` · ${item.priceMinor / 100} ${item.currency}` : ""}
                  {item.status === "sold" ? ` · ${translate(locale, "listing.sold")}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground">
            {listing.liveStatus
              ? translate(locale, `live.${listing.liveStatus.status}`)
              : translate(locale, "live.scheduled")}
          </p>
          {listing.hidden ? (
            <Alert variant="warning">{translate(locale, "moderation.listingHidden")}</Alert>
          ) : null}
          <form className="grid gap-3 border-t pt-4" onSubmit={moderate}>
            <Field>
              <Label htmlFor={`moderation-reason-${participation.id}`}>
                {translate(locale, "moderation.reason")}
              </Label>
              <Textarea
                className="min-h-20"
                id={`moderation-reason-${participation.id}`}
                maxLength={500}
                name="reason"
                required
              />
            </Field>
            <div className={actions}>
              {listing.version > 0 ? (
                <Button
                  size="sm"
                  type="submit"
                  value={listing.hidden ? "restore_listing" : "hide_listing"}
                  variant="outline"
                >
                  {translate(
                    locale,
                    listing.hidden ? "moderation.restoreListing" : "moderation.hideListing",
                  )}
                </Button>
              ) : null}
              {listing.items.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  type="submit"
                  value={`${item.hidden ? "restore_item" : "hide_item"}:${item.id}`}
                  variant="outline"
                >
                  {translate(
                    locale,
                    item.hidden ? "moderation.restoreItem" : "moderation.hideItem",
                  )}
                  : {item.name}
                </Button>
              ))}
              {participation.state === "approved" ? (
                <Button size="sm" type="submit" value="suspend" variant="destructive">
                  {translate(locale, "moderation.suspend")}
                </Button>
              ) : null}
              {participation.state === "suspended" ? (
                <Button size="sm" type="submit" value="reinstate" variant="outline">
                  {translate(locale, "moderation.reinstate")}
                </Button>
              ) : null}
            </div>
          </form>
          {eventActive && participation.state === "approved" ? (
            <form className="grid gap-3 border-t pt-4" onSubmit={onBehalf}>
              <Field>
                <Label htmlFor={`live-reason-${participation.id}`}>
                  {translate(locale, "live.onBehalfReason")}
                </Label>
                <Textarea
                  className="min-h-20"
                  id={`live-reason-${participation.id}`}
                  maxLength={500}
                  name="reason"
                />
              </Field>
              <div className={actions}>
                {(["open", "away", "closed_early"] as const).map((next) => (
                  <Button key={next} size="sm" type="submit" value={next} variant="outline">
                    {translate(locale, `live.set.${next}`)}
                  </Button>
                ))}
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {status || (loadFailed ? translate(locale, "listing.loadFailed") : "")}
      </p>
    </details>
  );
}
