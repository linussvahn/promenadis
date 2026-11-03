import { PromenadisApiError } from "@promenadis/api-client";
import type { SupportRequest } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { PageHeading } from "./page";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Radio } from "./ui/checkbox";
import { ChoiceField, Field, FieldGroup, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

const topics = ["support", "accessibility", "privacy", "safety", "legal"] as const;

// One first-party form for the five routes into the support mailbox.
export function SupportForm({ locale }: { readonly locale: Locale }) {
  // The route declares no search schema, so compare the raw value.
  const search = useSearch({ strict: false }) as Readonly<Record<string, unknown>>;
  const initial = topics.find((topic) => topic === search.topic) ?? "support";
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState("");
  const send = useMutation({
    mutationFn: async (form: FormData) => {
      const api = getPromenadisApiClient();
      if (!api) return false;
      await api.submitSupportRequest({
        contact: String(form.get("contact") ?? "").trim(),
        message: String(form.get("message") ?? ""),
        topic: String(form.get("topic")) as SupportRequest["topic"],
        website: String(form.get("website") ?? ""),
      });
      return true;
    },
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "rate_limited" || code === "paused" ? "support.busy" : "support.error",
        ),
      );
    },
    onSuccess: (submitted) => {
      if (submitted) setSent(true);
    },
  });
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    send.mutate(new FormData(formEvent.currentTarget));
  };
  return (
    <section aria-labelledby="support-title" className="grid max-w-3xl gap-6">
      <PageHeading
        description={translate(locale, "support.intro")}
        title={translate(locale, "support.title")}
        titleId="support-title"
      />
      {sent ? (
        <Alert role="status" variant="success">
          {translate(locale, "support.received")}
        </Alert>
      ) : (
        <Card asChild className="max-w-2xl">
          <form onSubmit={submit}>
            <CardContent>
              <FieldGroup>
                <Field>
                  <Label htmlFor="support-topic">{translate(locale, "support.topic")}</Label>
                  <NativeSelect defaultValue={initial} id="support-topic" name="topic">
                    {topics.map((topic) => (
                      <NativeSelectOption key={topic} value={topic}>
                        {translate(locale, `support.topic.${topic}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <Label htmlFor="support-message">{translate(locale, "support.message")}</Label>
                  <Textarea
                    id="support-message"
                    maxLength={2000}
                    minLength={10}
                    name="message"
                    required
                  />
                </Field>
                <Field>
                  <Label htmlFor="support-contact">{translate(locale, "support.contact")}</Label>
                  <Input
                    autoComplete="email"
                    id="support-contact"
                    maxLength={320}
                    name="contact"
                    type="email"
                  />
                </Field>
                <div aria-hidden="true" className="sr-only">
                  <label htmlFor="support-website">Website</label>
                  <input autoComplete="off" id="support-website" name="website" tabIndex={-1} />
                </div>
              </FieldGroup>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit">{translate(locale, "contact.send")}</Button>
              </div>
              <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
                {status}
              </p>
            </CardContent>
          </form>
        </Card>
      )}
    </section>
  );
}

// Non-identifiable post-event feedback; a follow-up address is optional.
export function EventFeedback({
  eventKey,
  locale,
  route,
}: {
  readonly eventKey: string;
  readonly locale: Locale;
  readonly route: "public" | "unlisted";
}) {
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState("");
  const send = useMutation({
    mutationFn: async (form: FormData) => {
      const api = getPromenadisApiClient();
      if (!api) return false;
      await api.submitEventFeedback(route, eventKey, {
        comment: String(form.get("comment") ?? ""),
        followupContact: String(form.get("followup") ?? "").trim(),
        rating: Number(form.get("rating")),
      });
      return true;
    },
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(translate(locale, code === "already_sent" ? "feedback.already" : "support.error"));
    },
    onSuccess: (submitted) => {
      if (submitted) setSent(true);
    },
  });
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    send.mutate(new FormData(formEvent.currentTarget));
  };
  if (sent) {
    return (
      <Alert role="status" variant="success">
        {translate(locale, "feedback.thanks")}
      </Alert>
    );
  }
  return (
    <Card asChild className="max-w-2xl">
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>{translate(locale, "feedback.title")}</CardTitle>
          <CardDescription>{translate(locale, "feedback.intro")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>{translate(locale, "feedback.rating")}</FieldLegend>
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <ChoiceField className="items-center" key={rating}>
                    <Radio className="mt-0" name="rating" required value={rating} />
                    <span>{rating}</span>
                  </ChoiceField>
                ))}
              </div>
            </FieldSet>
            <Field>
              <Label htmlFor="feedback-comment">{translate(locale, "feedback.comment")}</Label>
              <Textarea id="feedback-comment" maxLength={1000} name="comment" />
            </Field>
            <Field>
              <Label htmlFor="feedback-followup">{translate(locale, "feedback.followup")}</Label>
              <Input
                autoComplete="email"
                id="feedback-followup"
                maxLength={320}
                name="followup"
                type="email"
              />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">{translate(locale, "contact.send")}</Button>
          </div>
          <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
            {status}
          </p>
        </CardContent>
      </form>
    </Card>
  );
}
