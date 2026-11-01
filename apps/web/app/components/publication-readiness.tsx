import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary, EventPublicationReadiness } from "@promenadis/contracts";
import { type Locale, type MessageKey, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

const blockerKeys = {
  boundary_missing: "publication.blocker.boundary_missing",
  event_not_draft: "publication.blocker.event_not_draft",
  first_event_review_pending: "publication.blocker.first_event_review_pending",
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
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<EventPublicationReadiness | null>(null);
  const [status, setStatus] = useState("");

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  const loadReadiness = useCallback(async () => {
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) return;
      setReadiness(
        await authenticated.api.getEventPublicationReadiness(authenticated.token, event.id),
      );
    } catch {
      setStatus(translate(locale, "publication.error"));
    }
  }, [authenticatedClient, event.id, locale]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const attest = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!event.boundary || !event.registration) return;
    setBusy(true);
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) return;
      const nextReadiness = await authenticated.api.attestEventPublication(
        authenticated.token,
        event.id,
        {
          expectedBoundaryVersion: event.boundary.version,
          expectedEventVersion: event.version,
          expectedRegistrationVersion: event.registration.version,
          locationAuthorityConfirmed: true,
          visibilityUnderstood: true,
        },
      );
      setReadiness(nextReadiness);
      setStatus(translate(locale, "publication.attested"));
    } catch (error) {
      if (error instanceof PromenadisApiError && error.code === "recent_auth_required") {
        setStatus(translate(locale, "publication.recentAuth"));
      } else if (error instanceof PromenadisApiError && error.code === "version_conflict") {
        await loadReadiness();
        setStatus(translate(locale, "publication.versionConflict"));
      } else {
        setStatus(translate(locale, "publication.error"));
      }
    } finally {
      setBusy(false);
    }
  };

  const attestationMissing = readiness?.blockers.includes("publication_attestation_missing");
  const canAttest = event.role === "owner" && event.boundary && event.registration;

  return (
    <section aria-labelledby="publication-heading" className="panel publication-panel">
      <header>
        <h2 id="publication-heading">{translate(locale, "publication.title")}</h2>
        <p>{translate(locale, "publication.intro")}</p>
      </header>
      {!readiness ? (
        <p aria-live="polite">{status || translate(locale, "common.loading")}</p>
      ) : (
        <>
          <h3>{translate(locale, "publication.blockers")}</h3>
          <ul className="readiness-list">
            {readiness.blockers.map((blocker) => (
              <li key={blocker}>{translate(locale, blockerKeys[blocker])}</li>
            ))}
          </ul>
          {readiness.blockers.includes("recovery_code_missing") ? (
            <Link className="secondary-button button-link" to="/settings">
              {translate(locale, "publication.openSecurity")}
            </Link>
          ) : null}
          {readiness.recommendations.length > 0 ? (
            <>
              <h3>{translate(locale, "publication.recommendations")}</h3>
              <ul className="readiness-list readiness-list-secondary">
                {readiness.recommendations.map((recommendation) => (
                  <li key={recommendation}>
                    {translate(locale, recommendationKeys[recommendation])}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {attestationMissing && canAttest ? (
            <form className="attestation-form" onSubmit={attest}>
              <h3>{translate(locale, "publication.attestTitle")}</h3>
              <label className="checkbox-field">
                <input name="locationAuthority" required type="checkbox" />
                <span>{translate(locale, "publication.locationAuthorityConfirmed")}</span>
              </label>
              <label className="checkbox-field">
                <input name="visibilityUnderstood" required type="checkbox" />
                <span>
                  {translate(
                    locale,
                    event.visibility === "unlisted"
                      ? "publication.unlistedWarning"
                      : "publication.publicWarning",
                  )}
                </span>
              </label>
              <button className="primary-button" disabled={busy} type="submit">
                {busy
                  ? translate(locale, "common.saving")
                  : translate(locale, "publication.attest")}
              </button>
            </form>
          ) : null}

          {!attestationMissing ? (
            <p className="notice notice-success">
              {translate(locale, "publication.attestationCurrent")}
            </p>
          ) : null}
          <p className="field-help">{translate(locale, "publication.closedAlpha")}</p>
        </>
      )}
      {readiness ? (
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
