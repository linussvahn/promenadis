import type { DraftEventSummary, RelayThread } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
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
  const expectedAccountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const host = event.role === "owner" || event.role === "co_host";
  const threadsKey = accountKey(expectedAccountId, "event", event.id, "messages");
  const { data: threads = [] } = useQuery({
    enabled: host,
    queryKey: threadsKey,
    queryFn: async (): Promise<RelayThread[]> => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return [];
      try {
        return await api.listEventMessages(token, event.id);
      } catch {
        // Nothing to show.
        return [];
      }
    },
  });
  const replyMutation = useMutation({
    mutationFn: async ({ form, threadId }: { form: HTMLFormElement; threadId: string }) => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return null;
      return api.replyEventMessage(
        token,
        event.id,
        threadId,
        String(new FormData(form).get("message") ?? ""),
      );
    },
    onError: () => setStatus(translate(locale, "contact.error")),
    onSuccess: (updated, { form, threadId }) => {
      if (!updated) return;
      queryClient.setQueryData<RelayThread[]>(threadsKey, (current = []) =>
        current.map((thread) => (thread.id === threadId ? updated : thread)),
      );
      form.reset();
      setStatus(translate(locale, "contact.sent"));
    },
  });
  if (!host || threads.length === 0) return null;
  const reply = (threadId: string, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    replyMutation.mutate({ form: formEvent.currentTarget, threadId });
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
              <form className="grid gap-3" onSubmit={(formEvent) => reply(thread.id, formEvent)}>
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
  const expectedAccountId = useExpectedAccountId();
  const ended = event.state === "ended" || event.state === "archived";
  const { data: summary } = useQuery({
    enabled: ended,
    queryKey: accountKey(expectedAccountId, "event", event.id, "feedbackSummary"),
    queryFn: async (): Promise<{ responses: number; averageRating: number | null } | null> => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return null;
      try {
        return await api.getEventFeedbackSummary(token, event.id);
      } catch {
        // Nothing to show.
        return null;
      }
    },
  });
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
