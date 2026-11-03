import type { DraftEventSummary, RelayThread } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { RelayMessages } from "./organizer-contact";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// Messages visitors sent through the event page; answered in the app.
export function EventMessages({
  accessToken,
  event,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
}) {
  const [threads, setThreads] = useState<RelayThread[]>([]);
  const [status, setStatus] = useState("");
  const host = event.role === "owner" || event.role === "co_host";
  useEffect(() => {
    if (!host) return;
    void (async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      try {
        setThreads(await api.listEventMessages(token, event.id));
      } catch {
        // Nothing to show.
      }
    })();
  }, [accessToken, event.id, host]);
  if (!host || threads.length === 0) return null;
  const reply = async (threadId: string, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    try {
      const updated = await api.replyEventMessage(
        token,
        event.id,
        threadId,
        String(new FormData(form).get("message") ?? ""),
      );
      setThreads((current) => current.map((thread) => (thread.id === threadId ? updated : thread)));
      form.reset();
      setStatus(translate(locale, "contact.sent"));
    } catch {
      setStatus(translate(locale, "contact.error"));
    }
  };
  return (
    <Card asChild>
      <section aria-labelledby="event-messages-heading">
        <CardHeader>
          <CardTitle asChild>
            <h3 id="event-messages-heading">{translate(locale, "contact.teamTitle")}</h3>
          </CardTitle>
          <CardDescription>{translate(locale, "contact.teamHint")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-0 divide-y">
          {threads.map((thread) => (
            <article className="grid gap-4 py-5 first:pt-0" key={thread.id}>
              <RelayMessages locale={locale} thread={thread} />
              <form
                className="grid gap-3"
                onSubmit={(formEvent) => void reply(thread.id, formEvent)}
              >
                <Field>
                  <Label htmlFor={`reply-${thread.id}`}>{translate(locale, "contact.reply")}</Label>
                  <Textarea
                    id={`reply-${thread.id}`}
                    maxLength={1000}
                    minLength={10}
                    name="message"
                    required
                  />
                </Field>
                <Button className="justify-self-start" type="submit" variant="outline">
                  {translate(locale, "contact.send")}
                </Button>
              </form>
            </article>
          ))}
          <p aria-live="polite" className="min-h-6 pt-4 text-sm font-semibold" role="status">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}

// Aggregate post-event feedback; individual comments stay with the operator.
export function EventFeedbackSummary({
  accessToken,
  event,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
}) {
  const [summary, setSummary] = useState<{
    responses: number;
    averageRating: number | null;
  } | null>(null);
  const ended = event.state === "ended" || event.state === "archived";
  useEffect(() => {
    if (!ended) return;
    void (async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      try {
        setSummary(await api.getEventFeedbackSummary(token, event.id));
      } catch {
        // Nothing to show.
      }
    })();
  }, [accessToken, ended, event.id]);
  if (!summary || summary.responses === 0) return null;
  return (
    <Card asChild>
      <section aria-labelledby="feedback-summary-heading">
        <CardHeader>
          <CardTitle asChild>
            <h3 id="feedback-summary-heading">{translate(locale, "feedback.summary")}</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg">
            {summary.responses} {translate(locale, "feedback.responses")} ·{" "}
            {translate(locale, "feedback.average")} {summary.averageRating ?? "—"}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
