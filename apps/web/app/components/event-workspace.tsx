import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { BoundaryEditor } from "./boundary-editor";
import { CreationProgress } from "./creation-progress";
import { EventControls } from "./event-controls";
import { EventDetailsEditor } from "./event-details-editor";
import { EventDuplicate } from "./event-duplicate";
import { EventLifecycle } from "./event-lifecycle";
import { EventPublicLink } from "./event-public-link";
import { EventSellers } from "./event-sellers";
import { EventTeam } from "./event-team";
import { PublicationReadiness } from "./publication-readiness";
import { RegistrationEditor } from "./registration-editor";

type WorkspaceView = "overview" | "area" | "registration" | "review" | "sellers";

export function EventWorkspace({ view }: { readonly view: WorkspaceView }) {
  return (
    <AccountShell>
      {({ locale }) => <EventWorkspaceContent locale={locale} view={view} />}
    </AccountShell>
  );
}

function EventWorkspaceContent({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: WorkspaceView;
}) {
  const navigate = useNavigate();
  const { eventId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { accessToken, dashboard, loadDashboard, loadFailed } = useAccountData();
  const event = dashboard?.events.find((candidate) => candidate.id === eventId);
  const isCreationFlow = searchParams.get("new") === "1";

  if (loadFailed) {
    return (
      <main className="account-page app-page" id="main">
        <p className="notice notice-error" role="alert">
          {translate(locale, "dashboard.sessionExpired")}
        </p>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="account-page app-page" id="main">
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      </main>
    );
  }

  if (!event) {
    return (
      <main className="account-page app-page" id="main">
        <Link className="back-link" to="/dashboard">
          ← {translate(locale, "event.backToEvents")}
        </Link>
        <div className="notice notice-error" role="alert">
          {translate(locale, "event.notFound")}
        </div>
      </main>
    );
  }

  const interval = event.intervals[0];

  if (view === "area") {
    return (
      <main className="account-page flow-page wide-flow-page" id="main" tabIndex={-1}>
        <Link className="back-link" to={`/events/${event.id}`}>
          ← {translate(locale, "event.backToOverview")}
        </Link>
        {isCreationFlow ? <CreationProgress currentStep={2} locale={locale} /> : null}
        <header className="app-heading flow-heading">
          <p className="eyebrow">
            {isCreationFlow ? translate(locale, "creation.stepArea") : event.title}
          </p>
          <h1>{translate(locale, "boundary.title")}</h1>
          <p className="lede">{translate(locale, "boundary.intro")}</p>
        </header>
        <section aria-label={translate(locale, "boundary.title")} className="panel map-panel">
          <BoundaryEditor
            events={[event]}
            locale={locale}
            onSaved={async () => {
              await loadDashboard();
              if (isCreationFlow) await navigate(`/events/${event.id}/review`);
            }}
          />
        </section>
      </main>
    );
  }

  if (view === "review") {
    return (
      <main className="account-page flow-page" id="main" tabIndex={-1}>
        <Link className="back-link" to={`/events/${event.id}/area?new=1`}>
          ← {translate(locale, "creation.backToArea")}
        </Link>
        <CreationProgress currentStep={3} locale={locale} />
        <header className="app-heading flow-heading">
          <p className="eyebrow">{translate(locale, "creation.stepReview")}</p>
          <h1>{translate(locale, "creation.reviewTitle")}</h1>
          <p className="lede">{translate(locale, "creation.reviewIntro")}</p>
        </header>
        <section className="panel review-card">
          <div className="review-card-heading">
            <span className="status-pill status-pill-muted">
              {translate(locale, `event.state.${event.state}`)}
            </span>
            <h2>{event.title}</h2>
            <p>{event.organizerDisplayName}</p>
          </div>
          <dl className="summary-list">
            <div>
              <dt>{translate(locale, "event.schedule")}</dt>
              <dd>
                {interval
                  ? `${formatDateTime(locale, interval.startsAt, event.timezone)} – ${formatDateTime(locale, interval.endsAt, event.timezone)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{translate(locale, "dashboard.visibility")}</dt>
              <dd>{translate(locale, `visibility.${event.visibility}`)}</dd>
            </div>
            <div>
              <dt>{translate(locale, "boundary.title")}</dt>
              <dd>
                {event.boundary
                  ? event.boundary.displayLabel || translate(locale, "event.areaReady")
                  : translate(locale, "event.areaMissing")}
              </dd>
            </div>
            <div>
              <dt>{translate(locale, "registration.title")}</dt>
              <dd>
                {event.registration
                  ? `${formatDateTime(locale, event.registration.opensAt, event.timezone)} – ${formatDateTime(locale, event.registration.closesAt, event.timezone)}`
                  : translate(locale, "registration.missing")}
              </dd>
            </div>
          </dl>
          <div className="form-actions">
            <Link className="secondary-button button-link" to={`/events/${event.id}/area?new=1`}>
              {translate(locale, "creation.editArea")}
            </Link>
            <Link className="primary-button button-link" to={`/events/${event.id}`}>
              {translate(locale, "creation.finish")}
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (view === "sellers") {
    return (
      <main className="account-page flow-page" id="main" tabIndex={-1}>
        <Link className="back-link" to={`/events/${event.id}`}>
          ← {translate(locale, "event.backToOverview")}
        </Link>
        <header className="app-heading flow-heading">
          <p className="eyebrow">{event.title}</p>
          <h1>{translate(locale, "sellers.title")}</h1>
          <p className="lede">{translate(locale, "sellers.intro")}</p>
        </header>
        <EventSellers
          accessToken={accessToken}
          event={event}
          locale={locale}
          onChanged={loadDashboard}
        />
      </main>
    );
  }

  if (view === "registration") {
    return (
      <main className="account-page flow-page" id="main" tabIndex={-1}>
        <Link className="back-link" to={`/events/${event.id}`}>
          ← {translate(locale, "event.backToOverview")}
        </Link>
        <header className="app-heading flow-heading">
          <p className="eyebrow">{event.title}</p>
          <h1>{translate(locale, "registration.title")}</h1>
          <p className="lede">{translate(locale, "registration.intro")}</p>
        </header>
        <RegistrationEditor event={event} locale={locale} onSaved={loadDashboard} />
      </main>
    );
  }

  return (
    <main className="account-page app-page" id="main" tabIndex={-1}>
      <Link className="back-link" to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <header className="event-heading">
        <div>
          <div className="event-heading-status">
            <span className="status-pill status-pill-muted">
              {translate(locale, `event.state.${event.state}`)}
            </span>
            <span>{translate(locale, `visibility.${event.visibility}`)}</span>
          </div>
          <h1>{event.title}</h1>
          <p className="lede">{event.organizerDisplayName}</p>
        </div>
      </header>

      <div className="workspace-layout">
        <section aria-labelledby="overview-heading" className="workspace-main">
          <h2 id="overview-heading">{translate(locale, "event.overview")}</h2>
          <dl className="summary-list summary-list-card">
            <div>
              <dt>{translate(locale, "event.schedule")}</dt>
              <dd>
                {interval
                  ? `${formatDateTime(locale, interval.startsAt, event.timezone)} – ${formatDateTime(locale, interval.endsAt, event.timezone)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{translate(locale, "dashboard.visibility")}</dt>
              <dd>{translate(locale, `visibility.${event.visibility}`)}</dd>
            </div>
            <div>
              <dt>{translate(locale, "registration.title")}</dt>
              <dd>
                {event.registration
                  ? `${formatDateTime(locale, event.registration.opensAt, event.timezone)} – ${formatDateTime(locale, event.registration.closesAt, event.timezone)}`
                  : translate(locale, "registration.missing")}
              </dd>
            </div>
          </dl>
          <EventDetailsEditor
            accessToken={accessToken}
            event={event}
            locale={locale}
            onSaved={loadDashboard}
          />
          <EventControls
            event={event}
            locale={locale}
            onDeleted={async () => {
              await loadDashboard();
              await navigate("/dashboard", { replace: true });
            }}
            onSaved={loadDashboard}
          />
          <EventLifecycle event={event} locale={locale} onChanged={loadDashboard} />
          <EventPublicLink event={event} locale={locale} onChanged={loadDashboard} />
          {event.state === "draft" ? (
            <PublicationReadiness event={event} locale={locale} onPublished={loadDashboard} />
          ) : null}
          <EventTeam actorRole={event.role} eventId={event.id} locale={locale} />
          <EventDuplicate
            accessToken={accessToken}
            event={event}
            locale={locale}
            onCreated={async (createdId) => {
              await loadDashboard();
              await navigate(`/events/${createdId}`);
            }}
            organizers={dashboard.organizers}
          />
        </section>

        <aside aria-labelledby="setup-heading" className="setup-panel">
          <h2 id="setup-heading">{translate(locale, "event.setup")}</h2>
          <p>{translate(locale, "event.setupIntro")}</p>
          <ol className="setup-list">
            <li className="is-complete">
              <span aria-hidden="true" className="setup-number">
                ✓
              </span>
              <div>
                <strong>{translate(locale, "event.detailsReady")}</strong>
                <small>{translate(locale, "event.detailsReadyHelp")}</small>
              </div>
            </li>
            <li className={event.boundary ? "is-complete" : undefined}>
              <span aria-hidden="true" className="setup-number">
                {event.boundary ? "✓" : "2"}
              </span>
              <div>
                <strong>
                  {event.boundary
                    ? translate(locale, "event.areaReady")
                    : translate(locale, "event.areaMissing")}
                </strong>
                <small>
                  {event.boundary
                    ? translate(locale, "event.areaReadyHelp")
                    : translate(locale, "event.areaMissingHelp")}
                </small>
              </div>
              {event.state === "draft" ? (
                <Link className="text-link" to={`/events/${event.id}/area`}>
                  {event.boundary
                    ? translate(locale, "event.editArea")
                    : translate(locale, "event.addArea")}
                </Link>
              ) : null}
            </li>
            <li className={event.registration ? "is-complete" : undefined}>
              <span aria-hidden="true" className="setup-number">
                {event.registration ? "✓" : "3"}
              </span>
              <div>
                <strong>
                  {event.registration
                    ? translate(locale, "registration.ready")
                    : translate(locale, "registration.missing")}
                </strong>
                <small>
                  {event.registration
                    ? translate(locale, "registration.readyHelp")
                    : translate(locale, "registration.missingHelp")}
                </small>
              </div>
              {event.state === "draft" ? (
                <Link className="text-link" to={`/events/${event.id}/registration`}>
                  {event.registration
                    ? translate(locale, "registration.edit")
                    : translate(locale, "registration.add")}
                </Link>
              ) : null}
            </li>
          </ol>
          <Link className="secondary-button button-link" to={`/events/${event.id}/sellers`}>
            {translate(locale, "sellers.open")}
          </Link>
          <div className="upcoming-note">
            <strong>{translate(locale, "event.nextFeatures")}</strong>
            <span>{translate(locale, "event.nextFeaturesHelp")}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
