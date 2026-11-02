import { PromenadisApiError } from "@promenadis/api-client";
import type { OrganizerVerificationStatus } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";

// Optional registered-organization badge for association/company organizers.
export function OrganizerVerification({
  locale,
  organizerProfileId,
}: {
  readonly locale: Locale;
  readonly organizerProfileId: string;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [verification, setVerification] = useState<OrganizerVerificationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const client = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  useEffect(() => {
    void (async () => {
      const authenticated = await client();
      if (!authenticated) return;
      try {
        setVerification(
          await authenticated.api.getOrganizerVerification(authenticated.token, organizerProfileId),
        );
      } catch {
        setStatus(translate(locale, "verification.error"));
      }
    })();
  }, [client, locale, organizerProfileId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const authenticated = await client();
    if (!authenticated) return;
    setBusy(true);
    setStatus("");
    try {
      setVerification(
        await authenticated.api.requestOrganizerVerification(
          authenticated.token,
          organizerProfileId,
          {
            controlMethod: String(form.get("controlMethod")) as
              | "organization_email"
              | "official_website"
              | "official_contact",
            controlReference: String(form.get("controlReference") ?? ""),
            organizationNumber: String(form.get("organizationNumber") ?? ""),
          },
        ),
      );
      setStatus(translate(locale, "verification.requested"));
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "invalid_organization_number"
            ? "verification.invalidNumber"
            : "verification.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!verification) return null;
  const canRequest = ["none", "rejected", "revoked"].includes(verification.status);
  const prefix = `verification-${organizerProfileId}`;
  return (
    <div className="organizer-verification">
      <h3>{translate(locale, "verification.title")}</h3>
      <p>
        {verification.badge
          ? `${translate(locale, "verification.badge")} ${verification.registeredName ?? ""}`
          : translate(locale, `verification.status.${verification.status}`)}
      </p>
      {verification.badge && verification.recheckDueAt ? (
        <p className="field-help">
          {translate(locale, "verification.recheck")}{" "}
          {formatDateTime(locale, verification.recheckDueAt, "Europe/Stockholm")}
        </p>
      ) : null}
      {verification.reason ? (
        <p className="notice">
          {translate(locale, "publication.reviewReason")} {verification.reason}
        </p>
      ) : null}
      {canRequest ? (
        <details className="settings-details">
          <summary>{translate(locale, "verification.request")}</summary>
          <form className="form-panel details-form" onSubmit={submit}>
            <p className="field-help">{translate(locale, "verification.help")}</p>
            <label htmlFor={`${prefix}-number`}>{translate(locale, "verification.number")}</label>
            <input
              autoComplete="off"
              id={`${prefix}-number`}
              inputMode="numeric"
              maxLength={13}
              name="organizationNumber"
              placeholder="NNNNNN-NNNN"
              required
            />
            <label htmlFor={`${prefix}-method`}>{translate(locale, "verification.method")}</label>
            <select defaultValue="official_website" id={`${prefix}-method`} name="controlMethod">
              {(["official_website", "organization_email", "official_contact"] as const).map(
                (method) => (
                  <option key={method} value={method}>
                    {translate(locale, `verification.method.${method}`)}
                  </option>
                ),
              )}
            </select>
            <label htmlFor={`${prefix}-reference`}>
              {translate(locale, "verification.reference")}
            </label>
            <input
              id={`${prefix}-reference`}
              maxLength={200}
              minLength={3}
              name="controlReference"
              required
            />
            <button className="secondary-button" disabled={busy} type="submit">
              {translate(locale, "verification.submit")}
            </button>
          </form>
        </details>
      ) : null}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </div>
  );
}
