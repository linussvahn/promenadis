import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary, EventPublicationReadiness } from "@promenadis/contracts";
import { type Locale, type MessageKey, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useCallback, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField, FieldDescription } from "./ui/field";

const blockerKeys = {
  boundary_missing: "publication.blocker.boundary_missing",
  event_not_draft: "publication.blocker.event_not_draft",
  first_event_review_pending: "publication.blocker.first_event_review_pending",
  first_event_review_rejected: "publication.blocker.first_event_review_rejected",
  first_event_review_required: "publication.blocker.first_event_review_required",
  owner_email_unverified: "publication.blocker.owner_email_unverified",
  public_delivery_not_ready: "publication.blocker.public_delivery_not_ready",
  publication_attestation_missing: "publication.blocker.publication_attestation_missing",
  recovery_code_missing: "publication.blocker.recovery_code_missing",
  registration_missing: "publication.blocker.registration_missing",
  routing_not_ready: "publication.blocker.routing_not_ready",
} as const satisfies Record<EventPublicationReadiness["blockers"][number], MessageKey>;

const recommendationKeys = {
  emergency_successor_recommended: "publication.recommendation.successor",
  totp_recommended: "publication.recommendation.totp",
} as const satisfies Record<EventPublicationReadiness["recommendations"][number], MessageKey>;

export function PublicationReadiness({
  event,
  locale,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
}) {
  const expectedAccountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  const readinessKey = accountKey(expectedAccountId, "event", event.id, "publicationReadiness");
  const readinessQuery = useQuery({
    queryKey: readinessKey,
    queryFn: async (): Promise<EventPublicationReadiness | null> => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return null;
      return authenticated.api.getEventPublicationReadiness(authenticated.token, event.id);
    },
  });
  const readiness = readinessQuery.data ?? null;
  const loadError = readinessQuery.isError ? translate(locale, "publication.error") : "";
  const loadReadiness = () => queryClient.invalidateQueries({ queryKey: readinessKey });

  const rejected = readiness?.blockers.includes("first_event_review_rejected") ?? false;
  const reviewQuery = useQuery({
    enabled: rejected,
    queryKey: accountKey(expectedAccountId, "event", event.id, "firstEventReview"),
    queryFn: async () => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return null;
      return authenticated.api.getFirstEventReview(authenticated.token, event.id);
    },
  });
  const rejectionReason = rejected ? (reviewQuery.data?.reason ?? null) : null;

  const attestation = useMutation({
    mutationFn: async () => {
      if (!event.boundary || !event.registration) return null;
      const authenticated = await authenticatedClient();
      if (!authenticated) return null;
      return authenticated.api.attestEventPublication(authenticated.token, event.id, {
        expectedBoundaryVersion: event.boundary.version,
        expectedEventVersion: event.version,
        expectedRegistrationVersion: event.registration.version,
        locationAuthorityConfirmed: true,
        visibilityUnderstood: true,
      });
    },
    onError: async (error) => {
      if (error instanceof PromenadisApiError && error.code === "recent_auth_required") {
        setStatus(translate(locale, "publication.recentAuth"));
      } else if (error instanceof PromenadisApiError && error.code === "version_conflict") {
        await loadReadiness();
        setStatus(translate(locale, "publication.versionConflict"));
      } else {
        setStatus(translate(locale, "publication.error"));
      }
    },
    onMutate: () => setStatus(""),
    onSuccess: (nextReadiness) => {
      if (!nextReadiness) return;
      queryClient.setQueryData(readinessKey, nextReadiness);
      setStatus(translate(locale, "publication.attested"));
    },
  });

  const attest = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!event.boundary || !event.registration) return;
    attestation.mutate();
  };

  // Review is requested once only system gates (and the review itself) remain.
  const reviewable =
    event.role === "owner" &&
    readiness !== null &&
    readiness.blockers.some(
      (blocker) =>
        blocker === "first_event_review_required" || blocker === "first_event_review_rejected",
    ) &&
    readiness.blockers.every((blocker) =>
      [
        "first_event_review_required",
        "first_event_review_rejected",
        "routing_not_ready",
        "public_delivery_not_ready",
      ].includes(blocker),
    );

  const reviewRequest = useMutation({
    mutationFn: async () => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return null;
      return authenticated.api.requestFirstEventReview(
        authenticated.token,
        event.id,
        event.version,
      );
    },
    onError: async (error) => {
      if (error instanceof PromenadisApiError && error.code === "version_conflict") {
        await loadReadiness();
        setStatus(translate(locale, "publication.versionConflict"));
      } else {
        setStatus(translate(locale, "publication.error"));
      }
    },
    onMutate: () => setStatus(""),
    onSuccess: (nextReadiness) => {
      if (!nextReadiness) return;
      queryClient.setQueryData(readinessKey, nextReadiness);
      setStatus(translate(locale, "publication.reviewRequested"));
    },
  });
  const requestReview = () => reviewRequest.mutate();

  const publication = useMutation({
    mutationFn: async () => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return false;
      await authenticated.api.publishEvent(authenticated.token, event.id, event.version);
      setStatus(translate(locale, "publication.published"));
      // The event leaves the draft state, so reload it and everything under it.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountKey(expectedAccountId, "dashboard") }),
        queryClient.invalidateQueries({
          queryKey: accountKey(expectedAccountId, "event", event.id),
        }),
      ]);
      return true;
    },
    onError: async (error) => {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "recent_auth_required"
            ? "publication.recentAuth"
            : "publication.error",
        ),
      );
      await loadReadiness();
    },
    onMutate: () => setStatus(""),
  });
  const publish = () => publication.mutate();

  const busy = attestation.isPending || reviewRequest.isPending || publication.isPending;

  const attestationMissing = readiness?.blockers.includes("publication_attestation_missing");
  const canAttest = event.role === "owner" && event.boundary && event.registration;

  return (
    <Card asChild>
      <section aria-labelledby="publication-heading">
        <CardHeader>
          <CardTitle id="publication-heading">{translate(locale, "publication.title")}</CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {translate(locale, "publication.intro")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!readiness ? (
            <p aria-live="polite">{status || loadError || translate(locale, "common.loading")}</p>
          ) : (
            <>
              <h3 className={subheading}>{translate(locale, "publication.blockers")}</h3>
              <ul className="m-0 grid list-disc gap-2 pl-6 marker:text-primary">
                {readiness.blockers.map((blocker) => (
                  <li key={blocker}>{translate(locale, blockerKeys[blocker])}</li>
                ))}
              </ul>
              {rejectionReason ? (
                <Alert>
                  {translate(locale, "publication.reviewReason")} {rejectionReason}
                </Alert>
              ) : null}
              {(readiness.readyToPublish && event.role === "owner") ||
              reviewable ||
              readiness.blockers.includes("recovery_code_missing") ? (
                <div className="flex flex-wrap items-center gap-3">
                  {readiness.readyToPublish && event.role === "owner" ? (
                    <Button disabled={busy} onClick={publish} type="button">
                      {translate(locale, "publication.publish")}
                    </Button>
                  ) : null}
                  {reviewable ? (
                    <Button disabled={busy} onClick={requestReview} type="button">
                      {translate(locale, "publication.requestReview")}
                    </Button>
                  ) : null}
                  {readiness.blockers.includes("recovery_code_missing") ? (
                    <Button asChild variant="outline">
                      <Link to="/settings">{translate(locale, "publication.openSecurity")}</Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {readiness.recommendations.length > 0 ? (
                <>
                  <h3 className={subheading}>{translate(locale, "publication.recommendations")}</h3>
                  <ul className="m-0 grid list-disc gap-2 pl-6 text-muted-foreground">
                    {readiness.recommendations.map((recommendation) => (
                      <li key={recommendation}>
                        {translate(locale, recommendationKeys[recommendation])}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {attestationMissing && canAttest ? (
                <form className="grid gap-4 rounded-xl bg-muted p-4 sm:p-5" onSubmit={attest}>
                  <h3 className={subheading}>{translate(locale, "publication.attestTitle")}</h3>
                  <ChoiceField>
                    <Checkbox name="locationAuthority" required />
                    <span>{translate(locale, "publication.locationAuthorityConfirmed")}</span>
                  </ChoiceField>
                  <ChoiceField>
                    <Checkbox name="visibilityUnderstood" required />
                    <span>
                      {translate(
                        locale,
                        event.visibility === "unlisted"
                          ? "publication.unlistedWarning"
                          : "publication.publicWarning",
                      )}
                    </span>
                  </ChoiceField>
                  <Button className="justify-self-start" disabled={busy} type="submit">
                    {busy
                      ? translate(locale, "common.saving")
                      : translate(locale, "publication.attest")}
                  </Button>
                </form>
              ) : null}

              {!attestationMissing ? (
                <Alert variant="success">
                  {translate(locale, "publication.attestationCurrent")}
                </Alert>
              ) : null}
              <FieldDescription>{translate(locale, "publication.closedAlpha")}</FieldDescription>
            </>
          )}
          {readiness ? (
            <p aria-live="polite" className="min-h-6 text-sm font-semibold">
              {status}
            </p>
          ) : null}
        </CardContent>
      </section>
    </Card>
  );
}

const subheading = "font-display text-lg leading-tight font-extrabold";
