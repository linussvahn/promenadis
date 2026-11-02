import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { toDateTimeLocal, wallTimeToIso } from "../lib/wall-time";

// Title, description and schedule of a draft. Times are wall times in the
// event's own time zone, like the registration editor.
export function EventDetailsEditor({
  accessToken,
  event,
  locale,
  onSaved,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const interval = event.intervals[0];

  if (event.state !== "draft" || !["owner", "co_host"].includes(event.role) || !interval) {
    return null;
  }

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await api.updateDraftEventDetails(token, event.id, {
        description: String(form.get("description") ?? ""),
        endsAt: wallTimeToIso(String(form.get("endsAt") ?? ""), event.timezone),
        expectedVersion: event.version,
        startsAt: wallTimeToIso(String(form.get("startsAt") ?? ""), event.timezone),
        timezone: event.timezone,
        title: String(form.get("title") ?? ""),
      });
      await onSaved();
      setStatus(
        translate(locale, result.registrationReset ? "details.registrationReset" : "details.saved"),
      );
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "version_conflict"
            ? "event.versionConflict"
            : code === "invalid_request"
              ? "details.invalid"
              : "dashboard.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="panel settings-details">
      <summary>{translate(locale, "details.title")}</summary>
      <form className="form-panel details-form" key={event.version} onSubmit={save}>
        <p className="field-help">{translate(locale, "details.help")}</p>
        <label htmlFor="details-title">{translate(locale, "dashboard.eventTitle")}</label>
        <input
          defaultValue={event.title}
          id="details-title"
          maxLength={120}
          name="title"
          required
        />
        <label htmlFor="details-description">
          {translate(locale, "dashboard.eventDescription")}
        </label>
        <textarea
          defaultValue={event.description}
          id="details-description"
          maxLength={2000}
          name="description"
          rows={4}
        />
        <div className="schedule-fields">
          <div>
            <label htmlFor="details-start">{translate(locale, "dashboard.startsAt")}</label>
            <input
              defaultValue={toDateTimeLocal(interval.startsAt, event.timezone)}
              id="details-start"
              name="startsAt"
              required
              type="datetime-local"
            />
          </div>
          <div>
            <label htmlFor="details-end">{translate(locale, "dashboard.endsAt")}</label>
            <input
              defaultValue={toDateTimeLocal(interval.endsAt, event.timezone)}
              id="details-end"
              name="endsAt"
              required
              type="datetime-local"
            />
          </div>
        </div>
        <p className="field-help">
          {translate(locale, "dashboard.timezone")}: {event.timezone}
        </p>
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? translate(locale, "common.saving") : translate(locale, "details.save")}
        </button>
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      </form>
    </details>
  );
}
