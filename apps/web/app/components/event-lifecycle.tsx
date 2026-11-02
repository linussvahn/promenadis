import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { wallTimeToIso } from "../lib/wall-time";

// Live-event controls: owners cancel a published event; owners and co-hosts
// end a live event early. Drafts use EventControls instead.
export function EventLifecycle({
  event,
  locale,
  onChanged,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onChanged: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [confirmTitle, setConfirmTitle] = useState("");
  const [reason, setReason] = useState("");

  const teamLead = event.role === "owner" || event.role === "co_host";
  const canCancel =
    event.role === "owner" && (event.state === "published" || event.state === "postponed");
  const canEnd = event.state === "active" && teamLead;
  const canPostpone = teamLead && (event.state === "published" || event.state === "active");
  const canReschedule = teamLead && event.state === "postponed";
  if (!canCancel && !canEnd && !canPostpone && !canReschedule) return null;

  const runPostponement = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const token = data.session.user.id;
    setBusy(true);
    setStatus("");
    try {
      if (canReschedule) {
        await api.rescheduleEvent(token, event.id, {
          endsAt: wallTimeToIso(String(form.get("endsAt") ?? ""), event.timezone),
          expectedEventVersion: event.version,
          startsAt: wallTimeToIso(String(form.get("startsAt") ?? ""), event.timezone),
        });
        setStatus(translate(locale, "lifecycle.rescheduled"));
      } else {
        await api.postponeEvent(token, event.id, {
          expectedEventVersion: event.version,
          publicReason: String(form.get("postponeReason") ?? "").trim(),
        });
        setStatus(translate(locale, "lifecycle.postponed"));
      }
      await onChanged();
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "recent_auth_required"
            ? "lifecycle.recentAuthAny"
            : code === "invalid_replacement_date"
              ? "lifecycle.invalidReplacement"
              : code === "reschedule_window_closed"
                ? "lifecycle.rescheduleClosed"
                : code === "version_conflict"
                  ? "event.versionConflict"
                  : "lifecycle.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: "cancel" | "end") => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const token = data.session.user.id;
    setBusy(true);
    setStatus("");
    try {
      if (action === "cancel") {
        await api.cancelEvent(token, event.id, {
          confirmTitle: confirmTitle.trim(),
          expectedEventVersion: event.version,
          publicReason: reason.trim(),
        });
      } else {
        await api.endEventEarly(token, event.id, event.version);
      }
      setStatus(translate(locale, action === "cancel" ? "lifecycle.cancelled" : "lifecycle.ended"));
      await onChanged();
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "recent_auth_required"
            ? "lifecycle.recentAuth"
            : code === "version_conflict"
              ? "event.versionConflict"
              : "lifecycle.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="lifecycle-heading" className="panel">
      <h2 id="lifecycle-heading">{translate(locale, "lifecycle.title")}</h2>
      {canEnd ? (
        <>
          <p>{translate(locale, "lifecycle.endHelp")}</p>
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => void run("end")}
            type="button"
          >
            {translate(locale, "lifecycle.end")}
          </button>
        </>
      ) : canCancel ? (
        <details className="danger-zone">
          <summary>{translate(locale, "lifecycle.cancel")}</summary>
          <form
            className="danger-zone-body"
            onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
              formEvent.preventDefault();
              void run("cancel");
            }}
          >
            <p>{translate(locale, "lifecycle.cancelHelp")}</p>
            <label htmlFor="cancel-reason">{translate(locale, "lifecycle.reason")}</label>
            <textarea
              id="cancel-reason"
              maxLength={500}
              minLength={3}
              onChange={(inputEvent) => setReason(inputEvent.currentTarget.value)}
              required
              value={reason}
            />
            <label htmlFor="cancel-title">{translate(locale, "event.deleteConfirmation")}</label>
            <input
              autoComplete="off"
              id="cancel-title"
              onChange={(inputEvent) => setConfirmTitle(inputEvent.currentTarget.value)}
              placeholder={event.title}
              required
              value={confirmTitle}
            />
            <button
              className="danger-button"
              disabled={busy || confirmTitle.trim() !== event.title || reason.trim().length < 3}
              type="submit"
            >
              {translate(locale, "lifecycle.confirmCancel")}
            </button>
          </form>
        </details>
      ) : null}
      {canPostpone || canReschedule ? (
        <details className="danger-zone">
          <summary>
            {translate(locale, canReschedule ? "lifecycle.reschedule" : "lifecycle.postpone")}
          </summary>
          <form
            className="danger-zone-body"
            onSubmit={(formEvent) => void runPostponement(formEvent)}
          >
            <p>
              {translate(
                locale,
                canReschedule ? "lifecycle.rescheduleHelp" : "lifecycle.postponeHelp",
              )}
            </p>
            {canReschedule ? (
              <div className="schedule-fields">
                <div>
                  <label htmlFor="reschedule-start">
                    {translate(locale, "dashboard.startsAt")}
                  </label>
                  <input id="reschedule-start" name="startsAt" required type="datetime-local" />
                </div>
                <div>
                  <label htmlFor="reschedule-end">{translate(locale, "dashboard.endsAt")}</label>
                  <input id="reschedule-end" name="endsAt" required type="datetime-local" />
                </div>
              </div>
            ) : (
              <>
                <label htmlFor="postpone-reason">{translate(locale, "lifecycle.reason")}</label>
                <textarea
                  id="postpone-reason"
                  maxLength={500}
                  minLength={3}
                  name="postponeReason"
                  required
                />
              </>
            )}
            <button className="danger-button" disabled={busy} type="submit">
              {translate(
                locale,
                canReschedule ? "lifecycle.confirmReschedule" : "lifecycle.confirmPostpone",
              )}
            </button>
          </form>
        </details>
      ) : null}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
