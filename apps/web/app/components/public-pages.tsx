import type {
  PublicEventList,
  PublicEventSummary,
  PublicOrganizerPage,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { PageHeader } from "./page-header";

export function PublicShell({ children }: { readonly children: (locale: Locale) => ReactNode }) {
  const { locale, setLocale } = useStoredLocale();
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {translate(locale, "home.skip")}
      </a>
      <PageHeader
        action={
          <>
            <a className="header-action" href="/discover">
              {translate(locale, "nav.discover")}
            </a>
            <a className="header-action" href="/sign-in">
              {translate(locale, "nav.signIn")}
            </a>
          </>
        }
        locale={locale}
        onLocaleChange={setLocale}
      />
      <main id="main" tabIndex={-1}>
        {children(locale)}
      </main>
    </div>
  );
}

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
        <span className="public-interval" key={interval.startsAt}>
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
        <span className="status-pill verified-badge">{translate(locale, "public.verified")}</span>
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
    <li className="event-card">
      <div className="event-card-topline">
        <span className="status-pill status-pill-muted">
          {translate(locale, `event.state.${event.state}`)}
        </span>
        {event.areaLabel ? <span className="event-card-visibility">{event.areaLabel}</span> : null}
      </div>
      <div className="event-card-copy">
        <h2>{event.title}</h2>
        <p>{event.organizer.displayName}</p>
        <p>
          <Schedule event={event} locale={locale} />
        </p>
      </div>
      <div className="event-card-footer">
        <span />
        <Link className="text-link" to={eventPath(event)}>
          {translate(locale, "public.event.open")}
        </Link>
      </div>
    </li>
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
    <article aria-labelledby="event-title" className="public-event">
      {event.indexable ? <EventJsonLd event={event} url={canonicalUrl} /> : null}
      <p className="eyebrow">
        <span className="status-pill status-pill-muted">
          {translate(locale, `event.state.${event.state}`)}
        </span>
      </p>
      <h1 id="event-title">{event.title}</h1>
      {event.state === "postponed" || event.state === "cancelled" ? (
        <section className="panel public-notice" role="status">
          <h2>{translate(locale, `public.notice.${event.state}`)}</h2>
          {event.publicNotice ? <p>{event.publicNotice}</p> : null}
        </section>
      ) : null}
      {archived ? <p className="lede">{translate(locale, "public.archived")}</p> : null}
      {event.description ? <p className="lede">{event.description}</p> : null}
      <dl className="summary-list summary-list-card">
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
      </dl>
      {event.state === "published" || event.state === "active" ? (
        <p>
          <Link className="button" rel="nofollow" to={`${eventPath(event)}/map`}>
            {translate(locale, "map.showMap")}
          </Link>
        </p>
      ) : null}
      {event.visibility === "unlisted" ? (
        <p className="field-hint">{translate(locale, "public.unlistedNotice")}</p>
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
    <section aria-labelledby="discover-title" className="public-discovery">
      <p className="eyebrow">{translate(locale, "app.name")}</p>
      <h1 id="discover-title">{translate(locale, "public.discover.title")}</h1>
      <p className="lede">{translate(locale, "public.discover.intro")}</p>
      <Form className="panel form-panel discovery-search" method="get" role="search">
        <label htmlFor="discover-query">{translate(locale, "public.discover.search")}</label>
        <input defaultValue={query} id="discover-query" maxLength={100} name="q" type="search" />
        <label className="checkbox-field">
          <input defaultChecked={liveOnly} name="live" type="checkbox" value="1" />
          <span>{translate(locale, "public.discover.liveOnly")}</span>
        </label>
        <button className="button" type="submit">
          {translate(locale, "public.discover.searchButton")}
        </button>
      </Form>
      {list.events.length === 0 ? (
        <p role="status">{translate(locale, "public.discover.empty")}</p>
      ) : (
        <ul aria-label={translate(locale, "public.discover.title")} className="event-card-list">
          {list.events.map((event) => (
            <EventCard event={event} key={event.publicKey} locale={locale} />
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link className="text-link" to={`/discover?${moreParams.toString()}`}>
            {translate(locale, "public.discover.more")}
          </Link>
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
    <section aria-labelledby="organizer-title" className="public-organizer">
      <p className="eyebrow">{translate(locale, "public.organizer")}</p>
      <h1 id="organizer-title">{organizer.displayName}</h1>
      {organizer.verified ? (
        <p>
          <span className="status-pill verified-badge">{translate(locale, "public.verified")}</span>
        </p>
      ) : null}
      {organizer.locality ? <p className="lede">{organizer.locality}</p> : null}
      {organizer.website ? (
        <p>
          <a href={organizer.website} rel="noopener noreferrer nofollow ugc">
            {translate(locale, "public.website")}
          </a>
        </p>
      ) : null}
      <h2>{translate(locale, "public.organizerEvents")}</h2>
      <ul aria-label={translate(locale, "public.organizerEvents")} className="event-card-list">
        {organizer.events.map((event) => (
          <EventCard event={event} key={event.publicKey} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
