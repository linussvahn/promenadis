import { PromenadisApiError } from "@promenadis/api-client";
import type { OrganizerProfileSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";

// Organizer type is fixed after creation; a rename of a verified organization
// sends its badge back for review.
export function OrganizerProfileEditor({
  accessToken,
  locale,
  onSaved,
  organizer,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
  readonly onSaved: () => Promise<void>;
  readonly organizer: OrganizerProfileSummary;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const idPrefix = `organizer-edit-${organizer.id}`;

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setStatus("");
    try {
      await api.updateOrganizer(token, organizer.id, {
        displayName: String(form.get("displayName") ?? ""),
        expectedVersion: organizer.version,
        locality: String(form.get("locality") ?? ""),
        website: String(form.get("website") ?? "").trim(),
      });
      await onSaved();
      setStatus(translate(locale, "organizerEdit.saved"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "version_conflict"
            ? "organizerEdit.changed"
            : code === "invalid_request"
              ? "organizerEdit.invalid"
              : "dashboard.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="settings-details">
      <summary>{translate(locale, "organizerEdit.title")}</summary>
      <form className="form-panel details-form" key={organizer.version} onSubmit={save}>
        <p className="field-help">{translate(locale, "organizerEdit.help")}</p>
        <label htmlFor={`${idPrefix}-name`}>{translate(locale, "dashboard.organizerName")}</label>
        <input
          defaultValue={organizer.displayName}
          id={`${idPrefix}-name`}
          maxLength={100}
          name="displayName"
          required
        />
        <label htmlFor={`${idPrefix}-locality`}>{translate(locale, "dashboard.locality")}</label>
        <input
          defaultValue={organizer.locality ?? ""}
          id={`${idPrefix}-locality`}
          maxLength={100}
          name="locality"
        />
        <label htmlFor={`${idPrefix}-website`}>{translate(locale, "dashboard.website")}</label>
        <input
          defaultValue={organizer.website ?? ""}
          id={`${idPrefix}-website`}
          maxLength={500}
          name="website"
          placeholder="https://"
          type="url"
        />
        <button className="secondary-button" disabled={busy} type="submit">
          {busy ? translate(locale, "common.saving") : translate(locale, "organizerEdit.save")}
        </button>
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      </form>
    </details>
  );
}
