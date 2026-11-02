import { PromenadisApiError } from "@promenadis/api-client";
import type {
  AdminStatus,
  FirstEventReviewQueueItem,
  OrganizerVerificationQueueItem,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { AdminEventIntervention } from "./admin-event-intervention";
import { AdminModeration } from "./admin-moderation";
import { AdminOperationsPanel } from "./admin-operations";

export function AdminConsole() {
  return <AccountShell>{({ locale }) => <AdminContent locale={locale} />}</AccountShell>;
}

export function AdminContent({ locale }: { readonly locale: Locale }) {
  const { accessToken } = useAccountData();
  const [admin, setAdmin] = useState<AdminStatus | null>(null);
  const [queue, setQueue] = useState<FirstEventReviewQueueItem[]>([]);
  const [verifications, setVerifications] = useState<OrganizerVerificationQueueItem[]>([]);
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
      const next = await client.api.getAdminStatus(client.token);
      setAdmin(next);
      setQueue(next.elevated ? await client.api.listFirstEventReviews(client.token) : []);
      setVerifications(
        next.elevated ? await client.api.listOrganizerVerifications(client.token) : [],
      );
    } catch {
      setStatus(translate(locale, "admin.error"));
    }
  }, [call, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const errorText = (error: unknown) => {
    const code = error instanceof PromenadisApiError ? error.code : null;
    return translate(
      locale,
      code === "mfa_failed"
        ? "admin.codeFailed"
        : code === "mfa_required"
          ? "admin.totpRequired"
          : code === "elevation_required"
            ? "admin.elevationExpired"
            : code === "conflict_of_interest"
              ? "admin.ownEvent"
              : code === "version_conflict" || code === "review_unavailable"
                ? "admin.reviewChanged"
                : "admin.error",
    );
  };

  const elevate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("adminCode") ?? "").trim();
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.startAdminElevation(client.token, code);
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const exit = async () => {
    const client = await call();
    if (!client) return;
    setBusy(true);
    try {
      setAdmin(await client.api.endAdminElevation(client.token));
      setQueue([]);
      setVerifications([]);
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (item: FirstEventReviewQueueItem, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value === "rejected" ? "rejected" : "approved";
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.decideFirstEventReview(client.token, item.eventId, {
        decision,
        expectedEventVersion: item.eventVersion,
        reason: String(form.get("reason") ?? ""),
      });
      setStatus(translate(locale, decision === "approved" ? "admin.approved" : "admin.rejected"));
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const decideVerification = async (
    item: OrganizerVerificationQueueItem,
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value === "rejected" ? "rejected" : "verified";
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.decideOrganizerVerification(client.token, item.organizerProfileId, {
        controlConfirmed: form.get("controlConfirmed") === "on",
        decision,
        reason: String(form.get("reason") ?? "") || undefined,
        registeredName: String(form.get("registeredName") ?? "") || undefined,
        registryActive: form.get("registryActive") === "on",
      });
      setStatus(translate(locale, decision === "verified" ? "admin.verified" : "admin.rejected"));
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="account-page app-page" id="main" tabIndex={-1}>
      <header className="app-heading">
        <p className="eyebrow">Promenadis</p>
        <h1>{translate(locale, "admin.title")}</h1>
      </header>
      {!admin ? (
        <p aria-live="polite">{status || translate(locale, "common.loading")}</p>
      ) : !admin.eligible ? (
        <p className="notice">{translate(locale, "admin.notEligible")}</p>
      ) : !admin.elevated ? (
        <form className="panel form-panel" onSubmit={elevate}>
          <p>{translate(locale, "admin.elevateHelp")}</p>
          <label htmlFor="admin-code">{translate(locale, "mfa.code")}</label>
          <input
            autoComplete="one-time-code"
            id="admin-code"
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            name="adminCode"
            pattern="[0-9]{6}"
            required
          />
          <button className="primary-button" disabled={busy} type="submit">
            {translate(locale, "admin.elevate")}
          </button>
        </form>
      ) : (
        <>
          <div className="notice notice-warning" role="status">
            <strong>{translate(locale, "admin.active")}</strong>{" "}
            {admin.expiresAt
              ? `${translate(locale, "admin.until")} ${formatDateTime(locale, admin.expiresAt, "Europe/Stockholm")}`
              : null}{" "}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void exit()}
              type="button"
            >
              {translate(locale, "admin.exit")}
            </button>
          </div>
          <section aria-labelledby="review-queue-heading" className="panel">
            <h2 id="review-queue-heading">{translate(locale, "admin.queueTitle")}</h2>
            {queue.length === 0 ? <p>{translate(locale, "admin.queueEmpty")}</p> : null}
            {queue.map((item) => (
              <article className="panel" key={item.eventId}>
                <h3>{item.title}</h3>
                <p>
                  {item.organizerName} · {translate(locale, `organizerType.${item.organizerType}`)}{" "}
                  · {translate(locale, `visibility.${item.visibility}`)}
                </p>
                {item.description ? <p>{item.description}</p> : null}
                <p className="field-help">
                  {translate(locale, "admin.requestedAt")}{" "}
                  {formatDateTime(locale, item.requestedAt, "Europe/Stockholm")}
                </p>
                {item.ownEvent ? (
                  <p className="notice">{translate(locale, "admin.ownEvent")}</p>
                ) : !item.current ? (
                  <p className="notice">{translate(locale, "admin.reviewChanged")}</p>
                ) : (
                  <form className="form-panel" onSubmit={(event) => void decide(item, event)}>
                    <label htmlFor={`reason-${item.eventId}`}>
                      {translate(locale, "admin.reason")}
                    </label>
                    <textarea
                      id={`reason-${item.eventId}`}
                      maxLength={500}
                      minLength={3}
                      name="reason"
                      required
                    />
                    <button
                      className="primary-button"
                      disabled={busy}
                      type="submit"
                      value="approved"
                    >
                      {translate(locale, "admin.approve")}
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      type="submit"
                      value="rejected"
                    >
                      {translate(locale, "admin.reject")}
                    </button>
                  </form>
                )}
              </article>
            ))}
          </section>
          <section aria-labelledby="verification-queue-heading" className="panel">
            <h2 id="verification-queue-heading">{translate(locale, "admin.verificationTitle")}</h2>
            <p className="field-help">{translate(locale, "admin.verificationHelp")}</p>
            {verifications.length === 0 ? (
              <p>{translate(locale, "admin.verificationEmpty")}</p>
            ) : null}
            {verifications.map((item) => (
              <article className="panel" key={item.organizerProfileId}>
                <h3>{item.displayName}</h3>
                <p>
                  {item.organizationNumber} ·{" "}
                  {translate(locale, `organizerType.${item.organizerType}`)}
                </p>
                <p>
                  {translate(locale, `verification.method.${item.controlMethod}`)}:{" "}
                  {item.controlReference}
                </p>
                {item.ownOrganizer ? (
                  <p className="notice">{translate(locale, "admin.ownOrganizer")}</p>
                ) : (
                  <form
                    className="form-panel"
                    onSubmit={(event) => void decideVerification(item, event)}
                  >
                    <label htmlFor={`registered-${item.organizerProfileId}`}>
                      {translate(locale, "admin.registeredName")}
                    </label>
                    <input
                      id={`registered-${item.organizerProfileId}`}
                      maxLength={200}
                      name="registeredName"
                    />
                    <label className="checkbox-field">
                      <input name="registryActive" type="checkbox" />
                      <span>{translate(locale, "admin.registryActive")}</span>
                    </label>
                    <label className="checkbox-field">
                      <input name="controlConfirmed" type="checkbox" />
                      <span>{translate(locale, "admin.controlConfirmed")}</span>
                    </label>
                    <label htmlFor={`verification-reason-${item.organizerProfileId}`}>
                      {translate(locale, "admin.reason")}
                    </label>
                    <textarea
                      id={`verification-reason-${item.organizerProfileId}`}
                      maxLength={500}
                      name="reason"
                    />
                    <button
                      className="primary-button"
                      disabled={busy}
                      type="submit"
                      value="verified"
                    >
                      {translate(locale, "admin.verify")}
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      type="submit"
                      value="rejected"
                    >
                      {translate(locale, "admin.reject")}
                    </button>
                  </form>
                )}
              </article>
            ))}
          </section>
          <AdminEventIntervention call={call} locale={locale} />
          <AdminModeration call={call} locale={locale} />
          <AdminOperationsPanel call={call} locale={locale} />
        </>
      )}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </main>
  );
}
