import { formatDateTime, translate } from "@promenadis/i18n";
import { Link } from "react-router";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { IncomingOrganizerInvites } from "./incoming-organizer-invites";
import { IncomingTeamInvites } from "./incoming-team-invites";
import { MyParticipations } from "./my-participations";

export function Dashboard() {
  return <AccountShell>{({ locale }) => <DashboardContent locale={locale} />}</AccountShell>;
}

function DashboardContent({ locale }: { readonly locale: "sv" | "en" }) {
  const { accessToken, dashboard, loadDashboard, loadFailed } = useAccountData();

  return (
    <main className="account-page app-page" id="main" tabIndex={-1}>
      <header className="app-heading app-heading-row">
        <div>
          <p className="eyebrow">Promenadis</p>
          <h1>{translate(locale, "dashboard.events")}</h1>
          <p className="lede">{translate(locale, "dashboard.intro")}</p>
        </div>
        <Link className="primary-button button-link" to="/events/new">
          {translate(locale, "dashboard.newEvent")}
        </Link>
      </header>

      {dashboard ? (
        <>
          <IncomingOrganizerInvites
            displayName={dashboard.profile.displayName ?? ""}
            locale={locale}
            onAccepted={loadDashboard}
          />
          <IncomingTeamInvites
            displayName={dashboard.profile.displayName ?? ""}
            locale={locale}
            onAccepted={loadDashboard}
          />
          <MyParticipations accessToken={accessToken} locale={locale} />
        </>
      ) : null}

      {loadFailed ? (
        <p className="notice notice-error" role="alert">
          {translate(locale, "dashboard.sessionExpired")}
        </p>
      ) : !dashboard ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : dashboard.events.length === 0 ? (
        <section className="empty-state">
          <div aria-hidden="true" className="empty-state-mark">
            1
          </div>
          <h2>{translate(locale, "dashboard.emptyTitle")}</h2>
          <p>{translate(locale, "dashboard.emptyBody")}</p>
          <Link className="primary-button button-link" to="/events/new">
            {translate(locale, "dashboard.createFirstEvent")}
          </Link>
        </section>
      ) : (
        <ul aria-label={translate(locale, "dashboard.events")} className="event-card-list">
          {dashboard.events.map((draft) => {
            const interval = draft.intervals[0];
            return (
              <li className="event-card" key={draft.id}>
                <div className="event-card-topline">
                  <span className="status-pill status-pill-muted">
                    {translate(locale, `event.state.${draft.state}`)}
                  </span>
                  <span className="event-card-visibility">
                    {translate(locale, `visibility.${draft.visibility}`)}
                  </span>
                </div>
                <div className="event-card-copy">
                  <h2>{draft.title}</h2>
                  <p>{draft.organizerDisplayName}</p>
                  {interval ? (
                    <p>
                      {formatDateTime(locale, interval.startsAt, draft.timezone)} –{" "}
                      {formatDateTime(locale, interval.endsAt, draft.timezone)}
                    </p>
                  ) : null}
                </div>
                <div className="event-card-footer">
                  <span className={draft.boundary ? "setup-state is-complete" : "setup-state"}>
                    {draft.boundary
                      ? translate(locale, "event.areaReady")
                      : translate(locale, "event.areaMissing")}
                  </span>
                  <Link className="text-link" to={`/events/${draft.id}`}>
                    {translate(locale, draft.state === "draft" ? "event.continue" : "event.open")}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
