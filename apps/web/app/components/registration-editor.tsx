import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

function partsInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function toDateTimeLocal(value: string, timeZone: string): string {
  const parts = partsInTimeZone(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function wallTimeToIso(value: string, timeZone: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u);
  if (!match) throw new Error("invalid_wall_time");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsInTimeZone(new Date(instant).toISOString(), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    instant += target - represented;
  }

  return new Date(instant).toISOString();
}

function initialWindow(event: DraftEventSummary) {
  const interval = event.intervals[0];
  const closesAt =
    event.registration?.closesAt ??
    new Date(new Date(interval?.startsAt ?? Date.now()).getTime() - 60 * 60 * 1000).toISOString();
  const opensAt =
    event.registration?.opensAt ??
    new Date(Math.min(Date.now(), new Date(closesAt).getTime() - 60 * 60 * 1000)).toISOString();

  return {
    allowDuringEvent: event.registration?.allowDuringEvent ?? false,
    closesAt: toDateTimeLocal(closesAt, event.timezone),
    opensAt: toDateTimeLocal(opensAt, event.timezone),
  };
}

export function RegistrationEditor({
  event,
  locale,
  onSaved,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onSaved: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [window, setWindow] = useState(() => initialWindow(event));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setWindow(initialWindow(event));
  }, [event]);

  const saveRegistration = async (form: HTMLFormElement) => {
    const input = new FormData(form);
    const opensAt = String(input.get("opensAt") ?? "");
    const closesAt = String(input.get("closesAt") ?? "");
    const allowDuringEvent = input.get("allowDuringEvent") === "on";
    const api = getPromenadisApiClient();
    const supabase = getBrowserAuthClient(expectedAccountId);
    if (!api || !supabase) return;

    setBusy(true);
    setStatus("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
      await api.saveEventRegistration(data.session.user.id, event.id, {
        allowDuringEvent,
        closesAt: wallTimeToIso(closesAt, event.timezone),
        expectedVersion: event.registration?.version ?? null,
        opensAt: wallTimeToIso(opensAt, event.timezone),
      });
      await onSaved();
      setStatus(translate(locale, "registration.saved"));
    } catch (error) {
      const key =
        error instanceof PromenadisApiError && error.code === "version_conflict"
          ? "registration.versionConflict"
          : error instanceof PromenadisApiError && error.code === "active_event_opt_in_required"
            ? "registration.activeOptInRequired"
            : error instanceof PromenadisApiError && error.code === "invalid_registration"
              ? "registration.invalid"
              : "dashboard.error";
      setStatus(translate(locale, key));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="panel registration-form"
      onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
        formEvent.preventDefault();
        void saveRegistration(formEvent.currentTarget);
      }}
    >
      <div className="form-section">
        <h2>{translate(locale, "registration.windowTitle")}</h2>
        <p className="field-help">{translate(locale, "registration.windowHelp")}</p>
        <div className="schedule-fields">
          <div>
            <label htmlFor="registration-opens">{translate(locale, "registration.opensAt")}</label>
            <input
              id="registration-opens"
              name="opensAt"
              onChange={(inputEvent) => {
                const value = inputEvent.currentTarget.value;
                setWindow((current) => ({ ...current, opensAt: value }));
              }}
              required
              type="datetime-local"
              value={window.opensAt}
            />
          </div>
          <div>
            <label htmlFor="registration-closes">
              {translate(locale, "registration.closesAt")}
            </label>
            <input
              id="registration-closes"
              name="closesAt"
              onChange={(inputEvent) => {
                const value = inputEvent.currentTarget.value;
                setWindow((current) => ({ ...current, closesAt: value }));
              }}
              required
              type="datetime-local"
              value={window.closesAt}
            />
          </div>
        </div>
        <p className="field-help">
          {translate(locale, "registration.timezoneHelp")} {event.timezone}
        </p>
      </div>

      <div className="form-section">
        <label className="checkbox-field">
          <input
            checked={window.allowDuringEvent}
            name="allowDuringEvent"
            onChange={(inputEvent) => {
              const checked = inputEvent.currentTarget.checked;
              setWindow((current) => ({
                ...current,
                allowDuringEvent: checked,
              }));
            }}
            type="checkbox"
          />
          <span>
            <strong>{translate(locale, "registration.allowDuringEvent")}</strong>
            <small>{translate(locale, "registration.allowDuringEventHelp")}</small>
          </span>
        </label>
      </div>

      <div className="form-actions">
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? translate(locale, "common.saving") : translate(locale, "registration.save")}
        </button>
      </div>
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </form>
  );
}
