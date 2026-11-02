import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { AdminEventSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;

// Protective admin path: look up one event by id, then cancel it while
// published or end it while live. Both need an internal reason for the audit.
export function AdminEventIntervention({
  call,
  locale,
}: {
  readonly call: () => Promise<{ api: ApiClient; token: string } | null>;
  readonly locale: Locale;
}) {
  const [event, setEvent] = useState<AdminEventSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const errorText = (error: unknown) => {
    const code = error instanceof PromenadisApiError ? error.code : null;
    return translate(
      locale,
      code === "not_found"
        ? "admin.eventNotFound"
        : code === "elevation_required"
          ? "admin.elevationExpired"
          : code === "version_conflict" || code === "invalid_state"
            ? "admin.reviewChanged"
            : "admin.error",
    );
  };

  const lookup = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const eventId = String(new FormData(formEvent.currentTarget).get("eventId") ?? "").trim();
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    setEvent(null);
    try {
      setEvent(await client.api.getAdminEvent(client.token, eventId));
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const intervene = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!event) return;
    const form = new FormData(formEvent.currentTarget);
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value ?? "cancel";
    const internalReason = String(form.get("internalReason") ?? "");
    const publicReason = String(form.get("publicReason") ?? "");
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await client.api.interveneInEvent(
        client.token,
        event.id,
        action === "end_early"
          ? { action: "end_early", expectedEventVersion: event.version, internalReason }
          : {
              action: action === "postpone" ? "postpone" : "cancel",
              expectedEventVersion: event.version,
              internalReason,
              publicReason,
            },
      );
      setEvent({ ...event, state: result.state, version: result.version });
      setStatus(translate(locale, "admin.intervened"));
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const canCancel = event?.state === "published" || event?.state === "postponed";
  const canEnd = event?.state === "active";
  const canPostpone = event?.state === "published" || event?.state === "active";

  return (
    <section aria-labelledby="admin-event-heading" className="panel">
      <h2 id="admin-event-heading">{translate(locale, "admin.eventTitle")}</h2>
      <p>{translate(locale, "admin.eventHelp")}</p>
      <form className="inline-control" onSubmit={lookup}>
        <label className="visually-hidden" htmlFor="admin-event-id">
          {translate(locale, "admin.eventId")}
        </label>
        <input
          autoComplete="off"
          id="admin-event-id"
          name="eventId"
          pattern="[0-9a-fA-F-]{36}"
          placeholder={translate(locale, "admin.eventId")}
          required
        />
        <button className="secondary-button" disabled={busy} type="submit">
          {translate(locale, "admin.lookup")}
        </button>
      </form>
      {event ? (
        <article className="review-item">
          <h3>{event.title}</h3>
          <p>
            {event.organizerDisplayName} · {translate(locale, `event.state.${event.state}`)}
            {event.startsAt ? ` · ${formatDateTime(locale, event.startsAt, event.timezone)}` : null}
          </p>
          {canCancel || canEnd || canPostpone ? (
            <form className="details-form" onSubmit={intervene}>
              {canCancel || canPostpone ? (
                <>
                  <label htmlFor="admin-public-reason">
                    {translate(locale, "lifecycle.reason")}
                  </label>
                  <textarea
                    id="admin-public-reason"
                    maxLength={500}
                    minLength={3}
                    name="publicReason"
                  />
                </>
              ) : null}
              <label htmlFor="admin-internal-reason">
                {translate(locale, "admin.internalReason")}
              </label>
              <textarea
                id="admin-internal-reason"
                maxLength={500}
                minLength={3}
                name="internalReason"
                required
              />
              <div className="form-actions">
                {canEnd ? (
                  <button className="danger-button" disabled={busy} type="submit" value="end_early">
                    {translate(locale, "lifecycle.end")}
                  </button>
                ) : null}
                {canCancel ? (
                  <button className="danger-button" disabled={busy} type="submit" value="cancel">
                    {translate(locale, "lifecycle.cancel")}
                  </button>
                ) : null}
                {canPostpone ? (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    type="submit"
                    value="postpone"
                  >
                    {translate(locale, "lifecycle.postpone")}
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="field-help">{translate(locale, "admin.noIntervention")}</p>
          )}
        </article>
      ) : null}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
