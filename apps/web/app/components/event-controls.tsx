import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

export function EventControls({
  event,
  locale,
  onDeleted,
  onSaved,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onDeleted: () => Promise<void>;
  readonly onSaved: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [busyAction, setBusyAction] = useState<"delete" | "visibility" | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState(event.visibility);

  useEffect(() => {
    setVisibility(event.visibility);
  }, [event.visibility]);

  if (event.state !== "draft" || !["owner", "co_host"].includes(event.role)) return null;

  const accessToken = async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  };

  const saveVisibility = async () => {
    setBusyAction("visibility");
    setStatus("");
    try {
      const authenticated = await accessToken();
      if (!authenticated) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
      await authenticated.api.updateDraftEventVisibility(authenticated.token, event.id, {
        expectedVersion: event.version,
        visibility,
      });
      await onSaved();
      setStatus(translate(locale, "event.visibilitySaved"));
    } catch (error) {
      const key =
        error instanceof PromenadisApiError && error.code === "version_conflict"
          ? "event.versionConflict"
          : "dashboard.error";
      setStatus(translate(locale, key));
    } finally {
      setBusyAction(null);
    }
  };

  const deleteDraft = async () => {
    setBusyAction("delete");
    setStatus("");
    try {
      const authenticated = await accessToken();
      if (!authenticated) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
      await authenticated.api.deleteDraftEvent(authenticated.token, event.id, {
        confirmTitle,
        expectedVersion: event.version,
      });
      await onDeleted();
    } catch (error) {
      const key =
        error instanceof PromenadisApiError && error.code === "recent_auth_required"
          ? "event.deleteRecentAuth"
          : error instanceof PromenadisApiError && error.code === "version_conflict"
            ? "event.versionConflict"
            : error instanceof PromenadisApiError && error.code === "confirmation_mismatch"
              ? "event.deleteConfirmationMismatch"
              : "dashboard.error";
      setStatus(translate(locale, key));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section aria-labelledby="event-controls-heading" className="event-controls">
      <div>
        <h2 id="event-controls-heading">{translate(locale, "event.controls")}</h2>
        <p className="field-help">{translate(locale, "event.controlsHelp")}</p>
      </div>

      <form
        className="visibility-form"
        onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
          formEvent.preventDefault();
          void saveVisibility();
        }}
      >
        <label className="event-control-label" htmlFor="event-visibility">
          {translate(locale, "dashboard.visibility")}
        </label>
        <div className="inline-control">
          <select
            disabled={busyAction !== null}
            id="event-visibility"
            onChange={(inputEvent) =>
              setVisibility(inputEvent.currentTarget.value as typeof visibility)
            }
            value={visibility}
          >
            <option value="public">{translate(locale, "visibility.public")}</option>
            <option value="unlisted">{translate(locale, "visibility.unlisted")}</option>
          </select>
          <button
            className="secondary-button"
            disabled={busyAction !== null || visibility === event.visibility}
            type="submit"
          >
            {busyAction === "visibility"
              ? translate(locale, "common.saving")
              : translate(locale, "event.saveVisibility")}
          </button>
        </div>
        <p className="field-help">
          {visibility === "unlisted"
            ? translate(locale, "event.unlistedHelp")
            : translate(locale, "event.publicHelp")}
        </p>
      </form>

      {event.role === "owner" ? (
        <details className="danger-zone">
          <summary>{translate(locale, "event.deleteDraft")}</summary>
          <div className="danger-zone-body">
            <p>{translate(locale, "event.deleteHelp")}</p>
            <form
              onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
                formEvent.preventDefault();
                void deleteDraft();
              }}
            >
              <label className="event-control-label" htmlFor="confirm-event-title">
                {translate(locale, "event.deleteConfirmation")}
              </label>
              <input
                autoComplete="off"
                id="confirm-event-title"
                onChange={(inputEvent) => setConfirmTitle(inputEvent.currentTarget.value)}
                placeholder={event.title}
                required
                value={confirmTitle}
              />
              <button
                className="danger-button"
                disabled={busyAction !== null || confirmTitle.trim() !== event.title}
                type="submit"
              >
                {busyAction === "delete"
                  ? translate(locale, "event.deletingDraft")
                  : translate(locale, "event.confirmDelete")}
              </button>
            </form>
          </div>
        </details>
      ) : null}

      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
