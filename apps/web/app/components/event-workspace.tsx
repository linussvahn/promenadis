import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { lazy, type ReactNode, Suspense } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAccountData } from "../lib/use-account-data";
import { cn } from "../lib/utils";
import { AccountShell } from "./account-shell";
import { CreationProgress } from "./creation-progress";
import { EventControls } from "./event-controls";
import { EventDetailsEditor } from "./event-details-editor";
import { EventDuplicate } from "./event-duplicate";
import { EventExport } from "./event-export";
import { EventLifecycle } from "./event-lifecycle";
import { EventFeedbackSummary, EventMessages } from "./event-messages";
import { EventPublicLink } from "./event-public-link";
import { EventSellers } from "./event-sellers";
import { EventTeam } from "./event-team";
import { backLink, PageHeading, PageMain, SummaryList } from "./page";
import { PublicationReadiness } from "./publication-readiness";
import { RegistrationEditor } from "./registration-editor";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

// Map pages load maplibre on demand so other workspace pages stay light.
const BoundaryEditor = lazy(() =>
  import("./boundary-editor").then((module) => ({ default: module.BoundaryEditor })),
);
const WalkingNetwork = lazy(() =>
  import("./walking-network").then((module) => ({ default: module.WalkingNetwork })),
);

type WorkspaceView = "overview" | "area" | "registration" | "review" | "sellers" | "walking";

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
      <PageMain>
        <Alert role="alert" variant="destructive">
          {translate(locale, "dashboard.sessionExpired")}
        </Alert>
      </PageMain>
    );
  }

  if (!dashboard) {
    return (
      <PageMain>
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      </PageMain>
    );
  }

  if (!event) {
    return (
      <PageMain>
        <Link className={backLink} to="/dashboard">
          ← {translate(locale, "event.backToEvents")}
        </Link>
        <Alert role="alert" variant="destructive">
          {translate(locale, "event.notFound")}
        </Alert>
      </PageMain>
    );
  }

  const interval = event.intervals[0];
  const schedule = interval
    ? `${formatDateTime(locale, interval.startsAt, event.timezone)} – ${formatDateTime(locale, interval.endsAt, event.timezone)}`
    : "—";
  const registrationWindow = event.registration
    ? `${formatDateTime(locale, event.registration.opensAt, event.timezone)} – ${formatDateTime(locale, event.registration.closesAt, event.timezone)}`
    : translate(locale, "registration.missing");

  if (view === "area") {
    return (
      <PageMain width="wide">
        <Link className={backLink} to={`/events/${event.id}`}>
          ← {translate(locale, "event.backToOverview")}
        </Link>
        {isCreationFlow ? <CreationProgress currentStep={2} locale={locale} /> : null}
        <PageHeading
          description={translate(locale, "boundary.intro")}
          eyebrow={isCreationFlow ? translate(locale, "creation.stepArea") : event.title}
          title={translate(locale, "boundary.title")}
        />
        <Card asChild className="px-5 py-5 sm:px-8 sm:py-8">
          <section aria-label={translate(locale, "boundary.title")}>
            <Suspense fallback={<p role="status">{translate(locale, "common.loading")}</p>}>
              <BoundaryEditor
                events={[event]}
                locale={locale}
                onSaved={async () => {
                  await loadDashboard();
                  if (isCreationFlow) await navigate(`/events/${event.id}/review`);
                }}
              />
            </Suspense>
          </section>
        </Card>
      </PageMain>
    );
  }

  if (view === "review") {
    return (
      <PageMain width="flow">
        <Link className={backLink} to={`/events/${event.id}/area?new=1`}>
          ← {translate(locale, "creation.backToArea")}
        </Link>
        <CreationProgress currentStep={3} locale={locale} />
        <PageHeading
          description={translate(locale, "creation.reviewIntro")}
          eyebrow={translate(locale, "creation.stepReview")}
          title={translate(locale, "creation.reviewTitle")}
        />
        <Card asChild>
          <section>
            <CardHeader>
              <Badge variant="secondary">{translate(locale, `event.state.${event.state}`)}</Badge>
              <CardTitle className="mt-2 text-2xl">{event.title}</CardTitle>
              <CardDescription className="text-base">{event.organizerDisplayName}</CardDescription>
            </CardHeader>
            <CardContent>
              <SummaryList>
                <div>
                  <dt>{translate(locale, "event.schedule")}</dt>
                  <dd>{schedule}</dd>
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
                  <dd>{registrationWindow}</dd>
                </div>
              </SummaryList>
            </CardContent>
            <CardFooter className="border-t">
              <Button asChild variant="outline">
                <Link to={`/events/${event.id}/area?new=1`}>
                  {translate(locale, "creation.editArea")}
                </Link>
              </Button>
              <Button asChild>
                <Link to={`/events/${event.id}`}>{translate(locale, "creation.finish")}</Link>
              </Button>
            </CardFooter>
          </section>
        </Card>
      </PageMain>
    );
  }

  if (view === "sellers") {
    return (
      <PageMain width="flow">
        <Link className={backLink} to={`/events/${event.id}`}>
          ← {translate(locale, "event.backToOverview")}
        </Link>
        <PageHeading
          description={translate(locale, "sellers.intro")}
          eyebrow={event.title}
          title={translate(locale, "sellers.title")}
        />
        <EventSellers
          accessToken={accessToken}
          event={event}
          locale={locale}
          onChanged={loadDashboard}
        />
        <EventExport accessToken={accessToken} event={event} locale={locale} />
      </PageMain>
    );
  }

  if (view === "walking") {
    return (
      <PageMain width="wide">
        <Link className={backLink} to={`/events/${event.id}`}>
          ← {translate(locale, "event.backToOverview")}
        </Link>
        <PageHeading
          description={translate(locale, "walking.intro")}
          eyebrow={event.title}
          title={translate(locale, "walking.title")}
        />
        <Suspense fallback={<p role="status">{translate(locale, "common.loading")}</p>}>
          <WalkingNetwork accessToken={accessToken} event={event} locale={locale} />
        </Suspense>
      </PageMain>
    );
  }

  if (view === "registration") {
    return (
      <PageMain width="flow">
        <Link className={backLink} to={`/events/${event.id}`}>
          ← {translate(locale, "event.backToOverview")}
        </Link>
        <PageHeading
          description={translate(locale, "registration.intro")}
          eyebrow={event.title}
          title={translate(locale, "registration.title")}
        />
        <RegistrationEditor event={event} locale={locale} onSaved={loadDashboard} />
      </PageMain>
    );
  }

  return (
    <PageMain>
      <Link className={backLink} to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <PageHeading
        description={event.organizerDisplayName}
        meta={
          <>
            <Badge variant="secondary">{translate(locale, `event.state.${event.state}`)}</Badge>
            <span className="text-sm font-semibold text-muted-foreground">
              {translate(locale, `visibility.${event.visibility}`)}
            </span>
          </>
        }
        title={event.title}
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section aria-labelledby="overview-heading" className="grid min-w-0 content-start gap-5">
          <h2 className="font-display text-2xl font-extrabold" id="overview-heading">
            {translate(locale, "event.overview")}
          </h2>
          <SummaryList className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div>
              <dt>{translate(locale, "event.schedule")}</dt>
              <dd>{schedule}</dd>
            </div>
            <div>
              <dt>{translate(locale, "dashboard.visibility")}</dt>
              <dd>{translate(locale, `visibility.${event.visibility}`)}</dd>
            </div>
            <div>
              <dt>{translate(locale, "registration.title")}</dt>
              <dd>{registrationWindow}</dd>
            </div>
          </SummaryList>
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
          <EventMessages accessToken={accessToken} event={event} locale={locale} />
          <EventFeedbackSummary accessToken={accessToken} event={event} locale={locale} />
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

        <Card asChild className="lg:sticky lg:top-6">
          <aside aria-labelledby="setup-heading">
            <CardHeader>
              <CardTitle id="setup-heading">{translate(locale, "event.setup")}</CardTitle>
              <CardDescription className="text-base leading-relaxed">
                {translate(locale, "event.setupIntro")}
              </CardDescription>
            </CardHeader>
            <CardContent className="gap-5">
              <ol className="m-0 grid list-none divide-y border-t p-0">
                <SetupStep complete marker="✓">
                  <strong>{translate(locale, "event.detailsReady")}</strong>
                  <small>{translate(locale, "event.detailsReadyHelp")}</small>
                </SetupStep>
                <SetupStep
                  action={
                    event.state === "draft" ? (
                      <Link className="font-semibold" to={`/events/${event.id}/area`}>
                        {event.boundary
                          ? translate(locale, "event.editArea")
                          : translate(locale, "event.addArea")}
                      </Link>
                    ) : null
                  }
                  complete={Boolean(event.boundary)}
                  marker={event.boundary ? "✓" : "2"}
                >
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
                </SetupStep>
                <SetupStep
                  action={
                    event.state === "draft" ? (
                      <Link className="font-semibold" to={`/events/${event.id}/registration`}>
                        {event.registration
                          ? translate(locale, "registration.edit")
                          : translate(locale, "registration.add")}
                      </Link>
                    ) : null
                  }
                  complete={Boolean(event.registration)}
                  marker={event.registration ? "✓" : "3"}
                >
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
                </SetupStep>
              </ol>
              <div className="grid gap-3">
                <Button asChild variant="outline">
                  <Link to={`/events/${event.id}/sellers`}>
                    {translate(locale, "sellers.open")}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/events/${event.id}/walking`}>
                    {translate(locale, "walking.open")}
                  </Link>
                </Button>
              </div>
              <div className="grid gap-1 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                <strong className="text-foreground">
                  {translate(locale, "event.nextFeatures")}
                </strong>
                <span>{translate(locale, "event.nextFeaturesHelp")}</span>
              </div>
            </CardContent>
          </aside>
        </Card>
      </div>
    </PageMain>
  );
}

function SetupStep({
  complete,
  marker,
  action,
  children,
}: {
  readonly complete: boolean;
  readonly marker: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 py-4">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 place-items-center rounded-full font-extrabold text-primary-foreground",
          complete ? "bg-success" : "bg-primary",
        )}
      >
        {marker}
      </span>
      <div className="grid gap-0.5 [&_small]:text-sm [&_small]:leading-snug [&_small]:text-muted-foreground">
        {children}
      </div>
      {action ? <div className="col-start-2 justify-self-start">{action}</div> : null}
    </li>
  );
}
