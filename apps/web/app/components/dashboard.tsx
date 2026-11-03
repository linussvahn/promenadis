import { formatDateTime, translate } from "@promenadis/i18n";
import { Link } from "@tanstack/react-router";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { IncomingOrganizerInvites } from "./incoming-organizer-invites";
import { IncomingSellerInvites } from "./incoming-seller-invites";
import { IncomingTeamInvites } from "./incoming-team-invites";
import { MyModeration } from "./my-moderation";
import { MyNotifications } from "./my-notifications";
import { MyParticipations } from "./my-participations";
import { EmptyState, PageHeading, PageMain } from "./page";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";

export function Dashboard() {
  return <AccountShell>{({ locale }) => <DashboardContent locale={locale} />}</AccountShell>;
}

function DashboardContent({ locale }: { readonly locale: "sv" | "en" }) {
  const { accessToken, dashboard, loadDashboard, loadFailed } = useAccountData();

  return (
    <PageMain>
      <PageHeading
        actions={
          <Button asChild>
            <Link to="/events/new">{translate(locale, "dashboard.newEvent")}</Link>
          </Button>
        }
        description={translate(locale, "dashboard.intro")}
        eyebrow="Promenadis"
        title={translate(locale, "dashboard.events")}
      />

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
          <IncomingSellerInvites accessToken={accessToken} locale={locale} />
          <MyParticipations accessToken={accessToken} locale={locale} />
          <MyModeration accessToken={accessToken} locale={locale} />
          <MyNotifications accessToken={accessToken} locale={locale} />
        </>
      ) : null}

      {loadFailed ? (
        <Alert role="alert" variant="destructive">
          {translate(locale, "dashboard.sessionExpired")}
        </Alert>
      ) : !dashboard ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : dashboard.events.length === 0 ? (
        <EmptyState
          action={
            <Button asChild>
              <Link to="/events/new">{translate(locale, "dashboard.createFirstEvent")}</Link>
            </Button>
          }
          mark="1"
          title={translate(locale, "dashboard.emptyTitle")}
        >
          <p>{translate(locale, "dashboard.emptyBody")}</p>
        </EmptyState>
      ) : (
        <ul
          aria-label={translate(locale, "dashboard.events")}
          className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-5 p-0"
        >
          {dashboard.events.map((draft) => {
            const interval = draft.intervals[0];
            return (
              <Card asChild key={draft.id}>
                <li>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="secondary">
                        {translate(locale, `event.state.${draft.state}`)}
                      </Badge>
                      <span className="text-sm font-semibold text-muted-foreground">
                        {translate(locale, `visibility.${draft.visibility}`)}
                      </span>
                    </div>
                    <CardTitle className="mt-3 text-2xl">{draft.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="gap-1 text-muted-foreground">
                    <p>{draft.organizerDisplayName}</p>
                    {interval ? (
                      <p>
                        {formatDateTime(locale, interval.startsAt, draft.timezone)} –{" "}
                        {formatDateTime(locale, interval.endsAt, draft.timezone)}
                      </p>
                    ) : null}
                  </CardContent>
                  <CardFooter className="mt-auto justify-between border-t">
                    <span
                      className={
                        draft.boundary
                          ? "text-sm font-semibold text-success-foreground"
                          : "text-sm font-semibold text-warning-foreground"
                      }
                    >
                      {draft.boundary
                        ? translate(locale, "event.areaReady")
                        : translate(locale, "event.areaMissing")}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link params={{ eventId: draft.id }} to="/events/$eventId">
                        {translate(
                          locale,
                          draft.state === "draft" ? "event.continue" : "event.open",
                        )}
                      </Link>
                    </Button>
                  </CardFooter>
                </li>
              </Card>
            );
          })}
        </ul>
      )}
    </PageMain>
  );
}
