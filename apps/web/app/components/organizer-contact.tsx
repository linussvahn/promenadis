import { PromenadisApiError } from "@promenadis/api-client";
import type { RelayThread } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, MessageCircleIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

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
  const [status, setStatus] = useState("");
  const contact = useMutation({
    mutationFn: async (form: FormData) => {
      const api = getPromenadisApiClient();
      if (!api) return;
      const started = await api.contactOrganizer(route, eventKey, {
        message: String(form.get("message") ?? ""),
        visitorEmail: String(form.get("email") ?? "").trim(),
        website: String(form.get("website") ?? ""),
      });
      await navigate({
        hash: started.token,
        params: { threadId: started.threadId },
        to: "/contact/$threadId",
      });
    },
    onError: (error) => setStatus(translate(locale, errorKey(error))),
    onMutate: () => setStatus(""),
  });
  const busy = contact.isPending;
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!getPromenadisApiClient()) return;
    contact.mutate(new FormData(formEvent.currentTarget));
  };
  return (
    <Card asChild className="group gap-0 py-0">
      <details>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-6 py-3 font-display text-lg font-extrabold [&::-webkit-details-marker]:hidden">
          <MessageCircleIcon aria-hidden="true" className="size-5 text-primary" />
          {translate(locale, "contact.open")}
          <ChevronDownIcon
            aria-hidden="true"
            className="ml-auto size-5 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <form className="grid max-w-2xl gap-4 px-6 pt-1 pb-6" onSubmit={submit}>
          <FieldDescription>{translate(locale, "contact.intro")}</FieldDescription>
          <Field>
            <Label htmlFor="contact-email">{translate(locale, "contact.email")}</Label>
            <Input
              autoComplete="email"
              id="contact-email"
              maxLength={320}
              name="email"
              required
              type="email"
            />
          </Field>
          <Field>
            <Label htmlFor="contact-message">{translate(locale, "contact.message")}</Label>
            <Textarea
              id="contact-message"
              maxLength={1000}
              minLength={10}
              name="message"
              required
            />
          </Field>
          <div aria-hidden="true" className="sr-only">
            <label htmlFor="contact-website">Website</label>
            <input autoComplete="off" id="contact-website" name="website" tabIndex={-1} />
          </div>
          <div>
            <Button disabled={busy} type="submit">
              {translate(locale, "contact.send")}
            </Button>
          </div>
          <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
            {status}
          </p>
        </form>
      </details>
    </Card>
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
    <ol className="m-0 grid list-none gap-3 p-0">
      {thread.messages.map((message) => (
        <Card
          asChild
          className={
            message.direction === "visitor"
              ? "gap-2 py-4 sm:mr-12"
              : "gap-2 border-primary/30 bg-brand-soft/40 py-4 sm:ml-12"
          }
          key={message.id}
        >
          <li>
            <p className="px-5 text-sm text-muted-foreground">
              {translate(
                locale,
                message.direction === "visitor" ? "contact.fromVisitor" : "contact.fromOrganizer",
              )}{" "}
              · {formatDateTime(locale, message.createdAt, "Europe/Stockholm")}
            </p>
            <p className="px-5 leading-relaxed break-words whitespace-pre-wrap">{message.body}</p>
          </li>
        </Card>
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
  const queryClient = useQueryClient();
  // `null` until the fragment has been read in the browser.
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: another thread brings its own fragment.
  useEffect(() => {
    setToken(window.location.hash.slice(1));
  }, [threadId]);
  const api = getPromenadisApiClient();
  const threadKey = ["contact-thread", threadId, token] as const;
  const threadQuery = useQuery({
    enabled: Boolean(api && token),
    queryFn: () => {
      if (!api || !token) throw new Error("closed");
      return api.readContactThread(threadId, token);
    },
    queryKey: threadKey,
    retry: false,
  });
  const thread: RelayThread | null = threadQuery.data ?? null;
  const closed = token !== null && (!api || !token || threadQuery.isError);
  const shownStatus = status || (closed ? translate(locale, "contact.closed") : "");
  const send = useMutation({
    mutationFn: ({ message }: { form: HTMLFormElement; message: string }) => {
      if (!api || !token) throw new Error("closed");
      return api.replyContactThread(threadId, token, message);
    },
    onError: (error) => setStatus(translate(locale, errorKey(error))),
    onSuccess: (next, { form }) => {
      queryClient.setQueryData(threadKey, next);
      form.reset();
      setStatus(translate(locale, "contact.sent"));
    },
  });
  const reply = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    if (!api) return;
    send.mutate({ form, message: String(new FormData(form).get("message") ?? "") });
  };
  return (
    <section aria-labelledby="thread-title" className="grid gap-5">
      <h1
        className="text-4xl leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-5xl"
        id="thread-title"
      >
        {thread?.eventTitle ?? translate(locale, "contact.title")}
      </h1>
      <Alert>
        <AlertDescription>{translate(locale, "contact.keepLink")}</AlertDescription>
      </Alert>
      {thread ? <RelayMessages locale={locale} thread={thread} /> : null}
      {thread ? (
        <Card asChild className="max-w-2xl">
          <form onSubmit={reply}>
            <CardContent>
              <Field>
                <Label htmlFor="thread-reply">{translate(locale, "contact.reply")}</Label>
                <Textarea
                  id="thread-reply"
                  maxLength={1000}
                  minLength={10}
                  name="message"
                  required
                />
              </Field>
              <div>
                <Button type="submit">{translate(locale, "contact.send")}</Button>
              </div>
            </CardContent>
          </form>
        </Card>
      ) : null}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
        {shownStatus}
      </p>
    </section>
  );
}
