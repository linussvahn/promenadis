import { PromenadisApiError } from "@promenadis/api-client";
import type { EventForSeller } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { backLink, PageHeading, PageMain, SummaryList } from "./page";
import { SellerAddressForm, type SellerAddressInput } from "./seller-address-form";
import { SellerListingEditor } from "./seller-listing-editor";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
  const [searchParams] = useSearchParams();
  const inviteId = searchParams.get("invite");
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

  const acceptInvite = async (input: SellerAddressInput, form: FormData) => {
    const client = await call();
    if (!client || !inviteId) return;
    await client.api.acceptSellerInvite(client.token, inviteId, {
      ...input,
      displayName: String(form.get("displayName") ?? ""),
    });
    await load();
  };

  const confirmReschedule = async (accept: boolean) => {
    const participation = event?.participation;
    const client = await call();
    if (!participation || !client) return;
    setBusy(true);
    try {
      await client.api.confirmReschedule(client.token, participation.id, accept);
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
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
      <PageMain width="flow">
        <Alert role="alert" variant="destructive">
          {translate(locale, "seller.notFound")}
        </Alert>
      </PageMain>
    );
  }
  if (!event) {
    return (
      <PageMain width="flow">
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      </PageMain>
    );
  }

  const participation = event.participation;
  const closed = participation
    ? ["withdrawn", "rejected", "revoked"].includes(participation.state)
    : false;

  return (
    <PageMain width="flow">
      <Link className={backLink} to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <div className="grid gap-3">
        <PageHeading
          description={
            <>
              {event.organizerDisplayName}
              {event.startsAt
                ? ` · ${formatDateTime(locale, event.startsAt, event.timezone)}`
                : null}
            </>
          }
          eyebrow={translate(locale, "seller.eyebrow")}
          title={event.title}
        />
        {event.description ? (
          <p className="max-w-2xl leading-relaxed">{event.description}</p>
        ) : null}
      </div>

      {participation ? (
        <Card asChild>
          <section aria-labelledby="participation-heading">
            <CardHeader>
              <CardTitle id="participation-heading">
                {translate(locale, "seller.yourApplication")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                <Badge variant="secondary">
                  {translate(locale, `participation.${participation.state}`)}
                </Badge>
              </p>
              <p className="leading-relaxed">
                {translate(locale, `participation.${participation.state}.help`)}
              </p>
              {participation.decisionReason ? (
                <p>
                  {translate(locale, "seller.reason")}: {participation.decisionReason}
                </p>
              ) : null}
              {participation.location ? (
                <SummaryList>
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
                </SummaryList>
              ) : null}
              {participation.state === "pending_reschedule_confirmation" &&
              event.state === "published" ? (
                <div className="flex flex-wrap items-center gap-3">
                  {([true, false] as const).map((accept) => (
                    <Button
                      disabled={busy}
                      key={String(accept)}
                      onClick={() => void confirmReschedule(accept)}
                      type="button"
                      variant={accept ? "default" : "outline"}
                    >
                      {translate(locale, accept ? "seller.acceptNewDate" : "seller.declineNewDate")}
                    </Button>
                  ))}
                </div>
              ) : null}
              {event.state === "postponed" ? (
                <Alert variant="warning">{translate(locale, "seller.eventPostponed")}</Alert>
              ) : null}
              {participation.location?.quarantined ? (
                <Alert variant="destructive">{translate(locale, "seller.quarantined")}</Alert>
              ) : null}
              {participation.geographicException && !closed ? (
                <FieldDescription>{translate(locale, "seller.outsideHelp")}</FieldDescription>
              ) : null}
              {participation.location?.sellerCount && participation.location.sellerCount > 1 ? (
                <FieldDescription>{translate(locale, "seller.sharedStop")}</FieldDescription>
              ) : null}
              {!closed &&
              ["pending", "waitlisted", "approved", "pending_address_change"].includes(
                participation.state,
              ) &&
              ["draft", "published", "active"].includes(event.state) ? (
                <details className="grid gap-3 rounded-xl border bg-muted/40 px-4 py-3 [&>summary]:min-h-6 [&>summary]:cursor-pointer [&>summary]:font-semibold [&[open]>summary]:mb-3">
                  <summary>{translate(locale, "seller.changeAddress")}</summary>
                  <FieldDescription className="mb-4">
                    {translate(
                      locale,
                      ["approved", "pending_address_change"].includes(participation.state)
                        ? "seller.changeAddressReview"
                        : "seller.changeAddressHelp",
                    )}
                  </FieldDescription>
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
                <div>
                  <Button
                    disabled={busy}
                    onClick={() => void withdraw()}
                    type="button"
                    variant="outline"
                  >
                    {translate(locale, "seller.withdraw")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </section>
        </Card>
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
      {participation ? null : inviteId || event.registrationOpen ? (
        <Card asChild>
          <section aria-labelledby="apply-heading">
            <CardHeader>
              <CardTitle id="apply-heading">
                {translate(locale, inviteId ? "sellerInvite.acceptTitle" : "seller.applyTitle")}
              </CardTitle>
              <p className="text-muted-foreground">{translate(locale, "seller.applyIntro")}</p>
            </CardHeader>
            <CardContent>
              {event.placesFull ? (
                <Alert variant="warning">{translate(locale, "seller.placesFull")}</Alert>
              ) : null}
              <SellerAddressForm
                call={call}
                eventBoundary={event.boundary}
                eventId={eventId}
                idPrefix="seller"
                locale={locale}
                onSubmit={inviteId ? acceptInvite : apply}
                submitLabel={translate(locale, inviteId ? "sellerInvite.accept" : "seller.submit")}
              >
                <Field>
                  <Label htmlFor="seller-display-name">
                    {translate(locale, "seller.publicName")}
                  </Label>
                  <Input
                    aria-describedby="seller-display-name-help"
                    defaultValue={dashboard?.profile.displayName ?? ""}
                    id="seller-display-name"
                    maxLength={80}
                    name="displayName"
                    required
                  />
                  <FieldDescription id="seller-display-name-help">
                    {translate(locale, "seller.publicNameHelp")}
                  </FieldDescription>
                </Field>
              </SellerAddressForm>
            </CardContent>
          </section>
        </Card>
      ) : (
        <Alert>
          {translate(
            locale,
            event.admissionMode === "invite_only" ? "seller.inviteOnly" : "seller.closed",
          )}
        </Alert>
      )}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {status}
      </p>
    </PageMain>
  );
}
