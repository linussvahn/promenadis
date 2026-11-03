import type {
  PublicEventList,
  PublicEventSummary,
  PublicOrganizerPage,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { ContactOrganizer } from "./organizer-contact";
import { PageHeading, PageMain, SiteFooter, SummaryList, siteShell, skipLink } from "./page";
import { headerNavItem, PageHeader } from "./page-header";
import { EventFeedback } from "./support-forms";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField, Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function PublicShell({ children }: { readonly children: (locale: Locale) => ReactNode }) {
  const { locale, setLocale } = useStoredLocale();
  return (
    <div className={siteShell}>
      <a className={skipLink} href="#main">
        {translate(locale, "home.skip")}
      </a>
      <PageHeader
        action={
          <>
            <a className={headerNavItem} href="/discover">
              {translate(locale, "nav.discover")}
            </a>
            <a className={headerNavItem} href="/sign-in">
              {translate(locale, "nav.signIn")}
            </a>
          </>
        }
        locale={locale}
        onLocaleChange={setLocale}
      />
      <PageMain>{children(locale)}</PageMain>
      <SiteFooter>
        <a href="/support">{translate(locale, "support.footer")}</a> ·{" "}
        <a href="/support?topic=accessibility">
          {translate(locale, "support.topic.accessibility")}
        </a>{" "}
        · <a href="/support?topic=privacy">{translate(locale, "support.topic.privacy")}</a>
      </SiteFooter>
    </div>
  );
}

const cardGrid =
  "m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-5 p-0";

function eventPath(event: PublicEventSummary) {
  return `/${event.visibility === "public" ? "e" : "u"}/${event.publicKey}`;
}

function Schedule({
  event,
  locale,
}: {
  readonly event: PublicEventSummary;
  readonly locale: Locale;
}) {
  return (
    <>
      {event.intervals.map((interval) => (
        <span className="block" key={interval.startsAt}>
          {formatDateTime(locale, interval.startsAt, event.timezone)} –{" "}
          {formatDateTime(locale, interval.endsAt, event.timezone)}
        </span>
      ))}
    </>
  );
}

function OrganizerName({
  event,
  locale,
}: {
  readonly event: PublicEventSummary;
  readonly locale: Locale;
}) {
  const { organizer } = event;
  return (
    <>
      {organizer.publicKey ? (
        <Link to={`/o/${organizer.publicKey}`}>{organizer.displayName}</Link>
      ) : (
        organizer.displayName
      )}
      {organizer.verified ? (
        <Badge className="ms-2" variant="success">
          {translate(locale, "public.verified")}
        </Badge>
      ) : null}
    </>
  );
}

function EventCard({
  event,
  locale,
}: {
  readonly event: PublicEventSummary;
  readonly locale: Locale;
}) {
  return (
    <Card asChild>
      <li>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <Badge variant={event.state === "active" ? "default" : "secondary"}>
              {translate(locale, `event.state.${event.state}`)}
            </Badge>
            {event.areaLabel ? (
              <span className="text-sm font-semibold text-muted-foreground">{event.areaLabel}</span>
            ) : null}
          </div>
          <CardTitle className="mt-3 text-2xl">{event.title}</CardTitle>
        </CardHeader>
        <CardContent className="gap-1 text-muted-foreground">
          <p>{event.organizer.displayName}</p>
          <p>
            <Schedule event={event} locale={locale} />
          </p>
        </CardContent>
        <CardFooter className="mt-auto border-t">
          <Button asChild variant="outline">
            <Link to={eventPath(event)}>{translate(locale, "public.event.open")}</Link>
          </Button>
        </CardFooter>
      </li>
    </Card>
  );
}

const ldStatus = {
  active: "EventScheduled",
  archived: "EventScheduled",
  cancelled: "EventCancelled",
  ended: "EventScheduled",
  postponed: "EventPostponed",
  published: "EventScheduled",
} as const;

// Allowlisted structured data for indexable landing pages only.
function EventJsonLd({ event, url }: { readonly event: PublicEventSummary; readonly url: string }) {
  const first = event.intervals[0];
  const last = event.intervals.at(-1);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    description: event.description || undefined,
    endDate: last?.endsAt,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: `https://schema.org/${event.originalStartsAt && event.state === "published" ? "EventRescheduled" : ldStatus[event.state]}`,
    location: {
      "@type": "Place",
      address: event.organizer.locality ?? undefined,
      name: event.areaLabel ?? event.organizer.locality ?? event.title,
    },
    name: event.title,
    organizer: { "@type": "Organization", name: event.organizer.displayName },
    startDate: first?.startsAt,
    url,
  };
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: serialized allowlisted fields, `<` escaped.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</gu, "\\u003c") }}
      type="application/ld+json"
    />
  );
}

export function EventLanding({
  event,
  locale,
  canonicalUrl,
}: {
  readonly event: PublicEventSummary;
  readonly locale: Locale;
  readonly canonicalUrl: string;
}) {
  const archived = event.state === "archived";
  return (
    <article aria-labelledby="event-title" className="grid max-w-3xl gap-6">
      {event.indexable ? <EventJsonLd event={event} url={canonicalUrl} /> : null}
      <PageHeading
        description={
          archived
            ? translate(locale, "public.archived")
            : event.description
              ? event.description
              : undefined
        }
        meta={
          <Badge variant={event.state === "active" ? "default" : "secondary"}>
            {translate(locale, `event.state.${event.state}`)}
          </Badge>
        }
        title={event.title}
        titleId="event-title"
      />
      {archived && event.description ? (
        <p className="text-lg text-muted-foreground">{event.description}</p>
      ) : null}
      {event.state === "postponed" || event.state === "cancelled" ? (
        <section
          className="grid gap-2 rounded-2xl border border-sun/60 bg-warning-soft p-6 text-warning-foreground"
          role="status"
        >
          <h2 className="text-xl font-extrabold">
            {translate(locale, `public.notice.${event.state}`)}
          </h2>
          {event.publicNotice ? <p>{event.publicNotice}</p> : null}
        </section>
      ) : null}
      <Card>
        <CardContent>
          <SummaryList>
            <div>
              <dt>{translate(locale, "public.schedule")}</dt>
              <dd>
                <Schedule event={event} locale={locale} />
              </dd>
            </div>
            {event.originalStartsAt && !archived ? (
              <div>
                <dt>{translate(locale, "public.originalDate")}</dt>
                <dd>{formatDateTime(locale, event.originalStartsAt, event.timezone)}</dd>
              </div>
            ) : null}
            {event.areaLabel ? (
              <div>
                <dt>{translate(locale, "public.area")}</dt>
                <dd>{event.areaLabel}</dd>
              </div>
            ) : null}
            <div>
              <dt>{translate(locale, "public.organizer")}</dt>
              <dd>
                <OrganizerName event={event} locale={locale} />
              </dd>
            </div>
          </SummaryList>
        </CardContent>
      </Card>
      {event.state === "published" || event.state === "active" ? (
        <p>
          <Button asChild size="lg">
            <Link rel="nofollow" to={`${eventPath(event)}/map`}>
              {translate(locale, "map.showMap")}
            </Link>
          </Button>
        </p>
      ) : null}
      {event.visibility === "unlisted" ? (
        <p className="text-sm text-muted-foreground">
          {translate(locale, "public.unlistedNotice")}
        </p>
      ) : null}
      {["published", "active", "postponed"].includes(event.state) ? (
        <ContactOrganizer eventKey={event.publicKey} locale={locale} route={event.visibility} />
      ) : null}
      {event.state === "ended" ? (
        <EventFeedback eventKey={event.publicKey} locale={locale} route={event.visibility} />
      ) : null}
    </article>
  );
}

export function DiscoveryPage({
  list,
  locale,
  query,
  liveOnly,
}: {
  readonly list: PublicEventList;
  readonly locale: Locale;
  readonly query: string;
  readonly liveOnly: boolean;
}) {
  const next = list.nextCursor;
  const moreParams = new URLSearchParams();
  if (query) moreParams.set("q", query);
  if (liveOnly) moreParams.set("live", "1");
  if (next) moreParams.set("after", `${next.afterStartsAt}_${next.afterId}`);
  return (
    <section aria-labelledby="discover-title" className="grid gap-6">
      <PageHeading
        description={translate(locale, "public.discover.intro")}
        eyebrow={translate(locale, "app.name")}
        title={translate(locale, "public.discover.title")}
        titleId="discover-title"
      />
      <Card asChild>
        <Form className="px-6" method="get" role="search">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <Label htmlFor="discover-query">{translate(locale, "public.discover.search")}</Label>
              <Input
                defaultValue={query}
                id="discover-query"
                maxLength={100}
                name="q"
                type="search"
              />
            </Field>
            <Button type="submit">{translate(locale, "public.discover.searchButton")}</Button>
          </div>
          <ChoiceField>
            <Checkbox defaultChecked={liveOnly} name="live" value="1" />
            <span>{translate(locale, "public.discover.liveOnly")}</span>
          </ChoiceField>
        </Form>
      </Card>
      {list.events.length === 0 ? (
        <p className="text-muted-foreground" role="status">
          {translate(locale, "public.discover.empty")}
        </p>
      ) : (
        <ul aria-label={translate(locale, "public.discover.title")} className={cardGrid}>
          {list.events.map((event) => (
            <EventCard event={event} key={event.publicKey} locale={locale} />
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Button asChild variant="outline">
            <Link to={`/discover?${moreParams.toString()}`}>
              {translate(locale, "public.discover.more")}
            </Link>
          </Button>
        </p>
      ) : null}
    </section>
  );
}

export function OrganizerPublicPage({
  organizer,
  locale,
}: {
  readonly organizer: PublicOrganizerPage;
  readonly locale: Locale;
}) {
  return (
    <section aria-labelledby="organizer-title" className="grid gap-6">
      <PageHeading
        description={organizer.locality ?? undefined}
        eyebrow={translate(locale, "public.organizer")}
        meta={
          organizer.verified ? (
            <Badge variant="success">{translate(locale, "public.verified")}</Badge>
          ) : undefined
        }
        title={organizer.displayName}
        titleId="organizer-title"
      />
      {organizer.website ? (
        <p>
          <a href={organizer.website} rel="noopener noreferrer nofollow ugc">
            {translate(locale, "public.website")}
          </a>
        </p>
      ) : null}
      <h2 className="text-2xl font-extrabold">{translate(locale, "public.organizerEvents")}</h2>
      <ul aria-label={translate(locale, "public.organizerEvents")} className={cardGrid}>
        {organizer.events.map((event) => (
          <EventCard event={event} key={event.publicKey} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
