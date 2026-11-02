import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary, OrganizerProfileSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { toDateTimeLocal, wallTimeToIso } from "../lib/wall-time";

// Copies description, area and visibility into a new owner-only draft with new
// dates. Team, sellers and history are never copied.
export function EventDuplicate({
  accessToken,
  event,
  locale,
  onCreated,
  organizers,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onCreated: (eventId: string) => Promise<void>;
  readonly organizers: readonly OrganizerProfileSummary[];
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  if (!["owner", "co_host"].includes(event.role)) return null;

  const interval = event.intervals[0];
  const nextYear = (value: string | undefined) => {
    const date = new Date(value ?? Date.now());
    date.setFullYear(date.getFullYear() + 1);
    return toDateTimeLocal(date.toISOString(), event.timezone);
  };
  const defaultOrganizer =
    organizers.find((organizer) => organizer.id === event.organizerProfileId) ?? organizers[0];

  const duplicate = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token || !defaultOrganizer) return;
    setBusy(true);
    setStatus("");
    try {
      const created = await api.duplicateEvent(token, event.id, {
        endsAt: wallTimeToIso(String(form.get("endsAt") ?? ""), event.timezone),
        organizerProfileId: String(form.get("organizerProfileId") ?? defaultOrganizer.id),
        startsAt: wallTimeToIso(String(form.get("startsAt") ?? ""), event.timezone),
        title: String(form.get("title") ?? ""),
      });
      await onCreated(created.id);
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(locale, code === "invalid_request" ? "details.invalid" : "duplicate.error"),
      );
      setBusy(false);
    }
  };

  return (
    <details className="panel settings-details">
      <summary>{translate(locale, "duplicate.title")}</summary>
      {defaultOrganizer ? (
        <form className="form-panel details-form" onSubmit={duplicate}>
          <p className="field-help">{translate(locale, "duplicate.help")}</p>
          {organizers.length > 1 ? (
            <>
              <label htmlFor="duplicate-organizer">
                {translate(locale, "dashboard.organizingAs")}
              </label>
              <select
                defaultValue={defaultOrganizer.id}
                id="duplicate-organizer"
                name="organizerProfileId"
              >
                {organizers.map((organizer) => (
                  <option key={organizer.id} value={organizer.id}>
                    {organizer.displayName}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <label htmlFor="duplicate-title">{translate(locale, "dashboard.eventTitle")}</label>
          <input
            defaultValue={event.title}
            id="duplicate-title"
            maxLength={120}
            name="title"
            required
          />
          <div className="schedule-fields">
            <div>
              <label htmlFor="duplicate-start">{translate(locale, "dashboard.startsAt")}</label>
              <input
                defaultValue={nextYear(interval?.startsAt)}
                id="duplicate-start"
                name="startsAt"
                required
                type="datetime-local"
              />
            </div>
            <div>
              <label htmlFor="duplicate-end">{translate(locale, "dashboard.endsAt")}</label>
              <input
                defaultValue={nextYear(interval?.endsAt)}
                id="duplicate-end"
                name="endsAt"
                required
                type="datetime-local"
              />
            </div>
          </div>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? translate(locale, "common.saving") : translate(locale, "duplicate.create")}
          </button>
        </form>
      ) : (
        <p className="field-help">{translate(locale, "duplicate.noOrganizer")}</p>
      )}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </details>
  );
}
