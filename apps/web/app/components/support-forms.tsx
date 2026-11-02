import { PromenadisApiError } from "@promenadis/api-client";
import type { SupportRequest } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";

const topics = ["support", "accessibility", "privacy", "safety", "legal"] as const;

// One first-party form for the five routes into the support mailbox.
export function SupportForm({ locale }: { readonly locale: Locale }) {
  const [params] = useSearchParams();
  const initial = topics.find((topic) => topic === params.get("topic")) ?? "support";
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState("");
  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    if (!api) return;
    try {
      await api.submitSupportRequest({
        contact: String(form.get("contact") ?? "").trim(),
        message: String(form.get("message") ?? ""),
        topic: String(form.get("topic")) as SupportRequest["topic"],
        website: String(form.get("website") ?? ""),
      });
      setSent(true);
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "rate_limited" || code === "paused" ? "support.busy" : "support.error",
        ),
      );
    }
  };
  return (
    <section aria-labelledby="support-title" className="public-event">
      <h1 id="support-title">{translate(locale, "support.title")}</h1>
      <p className="lede">{translate(locale, "support.intro")}</p>
      {sent ? (
        <p className="notice" role="status">
          {translate(locale, "support.received")}
        </p>
      ) : (
        <form className="panel form-panel" onSubmit={(formEvent) => void submit(formEvent)}>
          <label htmlFor="support-topic">{translate(locale, "support.topic")}</label>
          <select defaultValue={initial} id="support-topic" name="topic">
            {topics.map((topic) => (
              <option key={topic} value={topic}>
                {translate(locale, `support.topic.${topic}`)}
              </option>
            ))}
          </select>
          <label htmlFor="support-message">{translate(locale, "support.message")}</label>
          <textarea id="support-message" maxLength={2000} minLength={10} name="message" required />
          <label htmlFor="support-contact">{translate(locale, "support.contact")}</label>
          <input
            autoComplete="email"
            id="support-contact"
            maxLength={320}
            name="contact"
            type="email"
          />
          <div aria-hidden="true" className="visually-hidden">
            <label htmlFor="support-website">Website</label>
            <input autoComplete="off" id="support-website" name="website" tabIndex={-1} />
          </div>
          <button className="primary-button" type="submit">
            {translate(locale, "contact.send")}
          </button>
          <p aria-live="polite" role="status">
            {status}
          </p>
        </form>
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
  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    if (!api) return;
    try {
      await api.submitEventFeedback(route, eventKey, {
        comment: String(form.get("comment") ?? ""),
        followupContact: String(form.get("followup") ?? "").trim(),
        rating: Number(form.get("rating")),
      });
      setSent(true);
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(translate(locale, code === "already_sent" ? "feedback.already" : "support.error"));
    }
  };
  if (sent) {
    return (
      <p className="notice" role="status">
        {translate(locale, "feedback.thanks")}
      </p>
    );
  }
  return (
    <form className="panel form-panel" onSubmit={(formEvent) => void submit(formEvent)}>
      <h2>{translate(locale, "feedback.title")}</h2>
      <p className="field-hint">{translate(locale, "feedback.intro")}</p>
      <fieldset className="choice-group">
        <legend>{translate(locale, "feedback.rating")}</legend>
        {[1, 2, 3, 4, 5].map((rating) => (
          <label className="checkbox-field" key={rating}>
            <input name="rating" required type="radio" value={rating} />
            <span>{rating}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="feedback-comment">{translate(locale, "feedback.comment")}</label>
      <textarea id="feedback-comment" maxLength={1000} name="comment" />
      <label htmlFor="feedback-followup">{translate(locale, "feedback.followup")}</label>
      <input
        autoComplete="email"
        id="feedback-followup"
        maxLength={320}
        name="followup"
        type="email"
      />
      <button className="primary-button" type="submit">
        {translate(locale, "contact.send")}
      </button>
      <p aria-live="polite" role="status">
        {status}
      </p>
    </form>
  );
}
