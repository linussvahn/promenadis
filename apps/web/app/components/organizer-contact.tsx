import { PromenadisApiError } from "@promenadis/api-client";
import type { RelayThread } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";

const errorKey = (error: unknown) => {
  const code = error instanceof PromenadisApiError ? error.code : "";
  return code === "rate_limited"
    ? "contact.rateLimited"
    : code === "relay_closed" || code === "not_found"
      ? "contact.closed"
      : "contact.error";
};

// Visitor-to-team relay: neither side sees the other's email address.
export function ContactOrganizer({
  eventKey,
  locale,
  route,
}: {
  readonly eventKey: string;
  readonly locale: Locale;
  readonly route: "public" | "unlisted";
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    if (!api) return;
    setBusy(true);
    setStatus("");
    try {
      const started = await api.contactOrganizer(route, eventKey, {
        message: String(form.get("message") ?? ""),
        visitorEmail: String(form.get("email") ?? "").trim(),
        website: String(form.get("website") ?? ""),
      });
      await navigate(`/contact/${started.threadId}#${started.token}`);
    } catch (error) {
      setStatus(translate(locale, errorKey(error)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="panel">
      <summary>{translate(locale, "contact.open")}</summary>
      <form className="form-panel" onSubmit={(formEvent) => void submit(formEvent)}>
        <p className="field-hint">{translate(locale, "contact.intro")}</p>
        <label htmlFor="contact-email">{translate(locale, "contact.email")}</label>
        <input
          autoComplete="email"
          id="contact-email"
          maxLength={320}
          name="email"
          required
          type="email"
        />
        <label htmlFor="contact-message">{translate(locale, "contact.message")}</label>
        <textarea id="contact-message" maxLength={1000} minLength={10} name="message" required />
        <div aria-hidden="true" className="visually-hidden">
          <label htmlFor="contact-website">Website</label>
          <input autoComplete="off" id="contact-website" name="website" tabIndex={-1} />
        </div>
        <button className="primary-button" disabled={busy} type="submit">
          {translate(locale, "contact.send")}
        </button>
        <p aria-live="polite" role="status">
          {status}
        </p>
      </form>
    </details>
  );
}

export function RelayMessages({
  locale,
  thread,
}: {
  readonly locale: Locale;
  readonly thread: RelayThread;
}) {
  return (
    <ol className="stop-list">
      {thread.messages.map((message) => (
        <li className="panel" key={message.id}>
          <p className="field-hint">
            {translate(
              locale,
              message.direction === "visitor" ? "contact.fromVisitor" : "contact.fromOrganizer",
            )}{" "}
            · {formatDateTime(locale, message.createdAt, "Europe/Stockholm")}
          </p>
          <p className="relay-body">{message.body}</p>
        </li>
      ))}
    </ol>
  );
}

// The visitor's private thread page: the token lives only in the URL
// fragment, which browsers never send to the server or as a referrer.
export function ContactThread({
  locale,
  threadId,
}: {
  readonly locale: Locale;
  readonly threadId: string;
}) {
  const [thread, setThread] = useState<RelayThread | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    setToken(fragment);
    const api = getPromenadisApiClient();
    if (!api || !fragment) {
      setStatus(translate(locale, "contact.closed"));
      return;
    }
    void api
      .readContactThread(threadId, fragment)
      .then(setThread)
      .catch(() => setStatus(translate(locale, "contact.closed")));
  }, [locale, threadId]);
  const reply = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const api = getPromenadisApiClient();
    if (!api) return;
    try {
      setThread(
        await api.replyContactThread(
          threadId,
          token,
          String(new FormData(form).get("message") ?? ""),
        ),
      );
      form.reset();
      setStatus(translate(locale, "contact.sent"));
    } catch (error) {
      setStatus(translate(locale, errorKey(error)));
    }
  };
  return (
    <section aria-labelledby="thread-title" className="public-event">
      <h1 id="thread-title">{thread?.eventTitle ?? translate(locale, "contact.title")}</h1>
      <p className="notice">{translate(locale, "contact.keepLink")}</p>
      {thread ? <RelayMessages locale={locale} thread={thread} /> : null}
      {thread ? (
        <form className="panel form-panel" onSubmit={(formEvent) => void reply(formEvent)}>
          <label htmlFor="thread-reply">{translate(locale, "contact.reply")}</label>
          <textarea id="thread-reply" maxLength={1000} minLength={10} name="message" required />
          <button className="primary-button" type="submit">
            {translate(locale, "contact.send")}
          </button>
        </form>
      ) : null}
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
