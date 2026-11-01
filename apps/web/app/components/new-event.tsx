import { translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { CreationProgress } from "./creation-progress";

function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Stockholm";
}

function toLocalDateTimeInput(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function defaultSchedule(): { readonly endsAt: string; readonly startsAt: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(15, 0, 0, 0);
  return { endsAt: toLocalDateTimeInput(end), startsAt: toLocalDateTimeInput(start) };
}

export function NewEvent() {
  return <AccountShell>{({ locale }) => <NewEventContent locale={locale} />}</AccountShell>;
}

function NewEventContent({ locale }: { readonly locale: "sv" | "en" }) {
  const navigate = useNavigate();
  const { accessToken, dashboard, loadFailed } = useAccountData();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [scheduleDefaults, setScheduleDefaults] = useState<ReturnType<
    typeof defaultSchedule
  > | null>(null);

  useEffect(() => {
    setScheduleDefaults(defaultSchedule());
  }, []);

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dashboard) return;
    const api = getPromenadisApiClient();
    const form = new FormData(event.currentTarget);
    const token = await accessToken();
    if (!api || !token) return;
    const selectedOrganizerId =
      dashboard.organizers.length > 1
        ? String(form.get("organizerProfileId") ?? "")
        : (dashboard.organizers[0]?.id ?? null);

    setBusy(true);
    setStatus("");
    try {
      const created = await api.createDraftEvent(token, {
        description: String(form.get("description") ?? ""),
        endsAt: new Date(String(form.get("endsAt") ?? "")).toISOString(),
        organizerProfileId: selectedOrganizerId,
        publicOrganizerName:
          dashboard.organizers.length === 0 ? String(form.get("publicOrganizerName") ?? "") : "",
        startsAt: new Date(String(form.get("startsAt") ?? "")).toISOString(),
        timezone: defaultTimeZone(),
        title: String(form.get("title") ?? ""),
        visibility: String(form.get("visibility") ?? "public") as "public" | "unlisted",
      });
      await navigate(`/events/${created.id}/area?new=1`);
    } catch {
      setStatus(translate(locale, "dashboard.error"));
      setBusy(false);
    }
  };

  return (
    <main className="account-page flow-page" id="main" tabIndex={-1}>
      <Link className="back-link" to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <CreationProgress currentStep={1} locale={locale} />
      <header className="app-heading flow-heading">
        <p className="eyebrow">{translate(locale, "creation.stepBasics")}</p>
        <h1>{translate(locale, "creation.basicsTitle")}</h1>
        <p className="lede">{translate(locale, "creation.basicsIntro")}</p>
      </header>

      {loadFailed ? (
        <p className="notice notice-error" role="alert">
          {translate(locale, "dashboard.sessionExpired")}
        </p>
      ) : !dashboard || !scheduleDefaults ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : (
        <form className="panel form-panel creation-form" onSubmit={createEvent}>
          {dashboard.organizers.length === 0 ? (
            <div className="form-section">
              <p className="form-section-title">{translate(locale, "dashboard.organizedByYou")}</p>
              <label htmlFor="public-organizer-name">
                {translate(locale, "dashboard.publicOrganizerName")}
              </label>
              <input
                aria-describedby="public-organizer-help"
                defaultValue={dashboard.profile.displayName ?? ""}
                id="public-organizer-name"
                maxLength={100}
                name="publicOrganizerName"
                required
              />
              <p className="field-help" id="public-organizer-help">
                {translate(locale, "dashboard.publicOrganizerHelp")}
              </p>
            </div>
          ) : dashboard.organizers.length === 1 ? (
            <p className="organizer-context">
              <span className="organizer-context-label">
                {translate(locale, "dashboard.organizingAs")}
              </span>
              <strong>{dashboard.organizers[0]?.displayName}</strong>
            </p>
          ) : (
            <div className="form-section">
              <label htmlFor="event-organizer">{translate(locale, "dashboard.organizingAs")}</label>
              <select id="event-organizer" name="organizerProfileId" required>
                {dashboard.organizers.map((organizer) => (
                  <option key={organizer.id} value={organizer.id}>
                    {organizer.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-section">
            <label htmlFor="event-title">{translate(locale, "dashboard.eventTitle")}</label>
            <input id="event-title" maxLength={120} name="title" required />
            <label htmlFor="event-description">
              {translate(locale, "dashboard.eventDescription")}
            </label>
            <textarea id="event-description" maxLength={2000} name="description" rows={4} />
          </div>

          <div className="form-section">
            <h2>{translate(locale, "creation.whenTitle")}</h2>
            <div className="schedule-fields">
              <div>
                <label htmlFor="event-start">{translate(locale, "dashboard.startsAt")}</label>
                <input
                  defaultValue={scheduleDefaults.startsAt}
                  id="event-start"
                  name="startsAt"
                  required
                  type="datetime-local"
                />
              </div>
              <div>
                <label htmlFor="event-end">{translate(locale, "dashboard.endsAt")}</label>
                <input
                  defaultValue={scheduleDefaults.endsAt}
                  id="event-end"
                  name="endsAt"
                  required
                  type="datetime-local"
                />
              </div>
            </div>
            <p className="field-help">
              {translate(locale, "dashboard.timezone")}: {defaultTimeZone()}.{" "}
              {translate(locale, "dashboard.timezoneHelp")}
            </p>
          </div>

          <div className="form-section">
            <label htmlFor="event-visibility">{translate(locale, "dashboard.visibility")}</label>
            <select defaultValue="public" id="event-visibility" name="visibility">
              <option value="public">{translate(locale, "visibility.public")}</option>
              <option value="unlisted">{translate(locale, "visibility.unlisted")}</option>
            </select>
            <p className="field-help">{translate(locale, "creation.visibilityHelp")}</p>
          </div>

          <div className="form-actions">
            <Link className="secondary-button button-link" to="/dashboard">
              {translate(locale, "common.cancel")}
            </Link>
            <button className="primary-button" disabled={busy} type="submit">
              {busy
                ? translate(locale, "common.saving")
                : translate(locale, "creation.continueToArea")}
            </button>
          </div>
          <p aria-live="polite" className="form-status">
            {status}
          </p>
        </form>
      )}
    </main>
  );
}
