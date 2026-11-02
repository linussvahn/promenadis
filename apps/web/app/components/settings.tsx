import type { OrganizerProfileSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountDeletion } from "./account-deletion";
import { AccountShell } from "./account-shell";
import { OrganizerTeam } from "./organizer-team";
import { OrganizerVerification } from "./organizer-verification";
import { RecoveryCode } from "./recovery-code";
import { TwoStep } from "./two-step";

type BusyAction = "profile" | "organizer" | null;

export function Settings() {
  return <AccountShell>{({ locale }) => <SettingsContent locale={locale} />}</AccountShell>;
}

function SettingsContent({ locale }: { readonly locale: Locale }) {
  const { accessToken, dashboard, deletionPending, loadDashboard, loadFailed, setDashboard } =
    useAccountData();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (dashboard) setDisplayName(dashboard.profile.displayName ?? "");
  }, [dashboard]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy("profile");
    setStatus("");
    try {
      const profile = await api.updateProfile(token, { displayName, preferredLocale: locale });
      setDashboard((current) => (current ? { ...current, profile } : current));
      setStatus(translate(locale, "dashboard.saved"));
    } catch {
      setStatus(translate(locale, "dashboard.error"));
    } finally {
      setBusy(null);
    }
  };

  const createOrganizer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    const form = new FormData(formElement);
    setBusy("organizer");
    setStatus("");
    try {
      await api.createOrganizer(token, {
        displayName: String(form.get("displayName") ?? ""),
        locality: String(form.get("locality") ?? ""),
        organizerType: String(form.get("organizerType") ?? "informal_group") as
          | "individual"
          | "informal_group"
          | "association"
          | "company",
        website: String(form.get("website") ?? ""),
      });
      formElement.reset();
      await loadDashboard();
      setStatus(translate(locale, "dashboard.created"));
    } catch {
      setStatus(translate(locale, "dashboard.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="account-page app-page settings-page" id="main" tabIndex={-1}>
      <Link className="back-link" to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <header className="app-heading">
        <p className="eyebrow">Promenadis</p>
        <h1>{translate(locale, "settings.title")}</h1>
        <p className="lede">{translate(locale, "settings.intro")}</p>
      </header>

      {deletionPending ? (
        <AccountDeletion accessToken={accessToken} locale={locale} onCancelled={loadDashboard} />
      ) : loadFailed ? (
        <p className="notice notice-error" role="alert">
          {translate(locale, "dashboard.sessionExpired")}
        </p>
      ) : !dashboard ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : (
        <div className="settings-grid">
          <section aria-labelledby="profile-heading" className="panel">
            <h2 id="profile-heading">{translate(locale, "dashboard.profile")}</h2>
            <p>{translate(locale, "settings.profileHelp")}</p>
            <form className="form-panel" onSubmit={saveProfile}>
              <label htmlFor="profile-display-name">
                {translate(locale, "dashboard.displayName")}
              </label>
              <input
                id="profile-display-name"
                maxLength={80}
                name="displayName"
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                value={displayName}
              />
              <button className="primary-button" disabled={busy !== null} type="submit">
                {translate(locale, "dashboard.saveProfile")}
              </button>
            </form>
            <div className="personal-organizer">
              <h3>{translate(locale, "settings.personalOrganizerTitle")}</h3>
              <p>{translate(locale, "settings.personalOrganizerHelp")}</p>
              {dashboard.organizers.find(
                (organizer) => organizer.organizerType === "individual",
              ) ? (
                <strong>
                  {
                    dashboard.organizers.find(
                      (organizer) => organizer.organizerType === "individual",
                    )?.displayName
                  }
                </strong>
              ) : (
                <form className="form-panel" onSubmit={createOrganizer}>
                  <input name="organizerType" type="hidden" value="individual" />
                  <input name="locality" type="hidden" value="" />
                  <input name="website" type="hidden" value="" />
                  <label htmlFor="personal-organizer-name">
                    {translate(locale, "dashboard.publicOrganizerName")}
                  </label>
                  <input id="personal-organizer-name" maxLength={100} name="displayName" required />
                  <button className="secondary-button" disabled={busy !== null} type="submit">
                    {translate(locale, "settings.createPersonalOrganizer")}
                  </button>
                </form>
              )}
            </div>
          </section>

          <section aria-labelledby="organizers-heading" className="panel">
            <h2 id="organizers-heading">{translate(locale, "settings.organizersTitle")}</h2>
            <p>{translate(locale, "dashboard.additionalOrganizersHelp")}</p>
            <OrganizerList
              locale={locale}
              organizers={dashboard.organizers.filter(
                (organizer) => organizer.organizerType !== "individual",
              )}
            />
            <details className="settings-details">
              <summary>{translate(locale, "dashboard.newOrganizer")}</summary>
              <form className="form-panel details-form" onSubmit={createOrganizer}>
                <label htmlFor="organizer-name">
                  {translate(locale, "dashboard.organizerName")}
                </label>
                <input id="organizer-name" maxLength={100} name="displayName" required />
                <label htmlFor="organizer-type">
                  {translate(locale, "dashboard.organizerType")}
                </label>
                <select defaultValue="informal_group" id="organizer-type" name="organizerType">
                  {(["informal_group", "association", "company"] as const).map((value) => (
                    <option key={value} value={value}>
                      {translate(locale, `organizerType.${value}`)}
                    </option>
                  ))}
                </select>
                <label htmlFor="organizer-locality">
                  {translate(locale, "dashboard.locality")}
                </label>
                <input id="organizer-locality" maxLength={100} name="locality" />
                <label htmlFor="organizer-website">{translate(locale, "dashboard.website")}</label>
                <input
                  id="organizer-website"
                  maxLength={500}
                  name="website"
                  placeholder="https://"
                  type="url"
                />
                <button className="primary-button" disabled={busy !== null} type="submit">
                  {translate(locale, "dashboard.createOrganizer")}
                </button>
              </form>
            </details>
          </section>
          <RecoveryCode accessToken={accessToken} locale={locale} />
          <TwoStep accessToken={accessToken} locale={locale} />
          <AccountDeletion accessToken={accessToken} locale={locale} onCancelled={loadDashboard} />
        </div>
      )}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </main>
  );
}

function OrganizerList({
  locale,
  organizers,
}: {
  readonly locale: Locale;
  readonly organizers: readonly OrganizerProfileSummary[];
}) {
  if (organizers.length === 0) {
    return <p className="muted-copy">{translate(locale, "dashboard.noAdditionalOrganizers")}</p>;
  }
  return (
    <ul className="resource-list">
      {organizers.map((organizer) => (
        <li key={organizer.id}>
          <strong>{organizer.displayName}</strong>
          <span>{translate(locale, `organizerType.${organizer.organizerType}`)}</span>
          {organizer.locality ? <span>{organizer.locality}</span> : null}
          <OrganizerTeam
            locale={locale}
            organizerProfileId={organizer.id}
            owner={organizer.role === "owner"}
          />
          {organizer.organizerType === "association" || organizer.organizerType === "company" ? (
            <OrganizerVerification locale={locale} organizerProfileId={organizer.id} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
