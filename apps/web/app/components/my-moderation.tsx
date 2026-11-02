import { PromenadisApiError } from "@promenadis/api-client";
import type { MyModerationAction } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";

// Decisions that affected the signed-in seller, with an appeal per decision.
export function MyModeration({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const [items, setItems] = useState<MyModerationAction[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      try {
        const next = await api.listMyModeration(token);
        if (!cancelled) setItems(next);
      } catch {
        // The events list above already reports session problems.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const appeal = async (item: MyModerationAction, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const statement = String(new FormData(formEvent.currentTarget).get("statement") ?? "").trim();
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    try {
      setItems(await api.submitAppeal(token, item.id, statement));
      setStatus(translate(locale, "appeal.sent"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "appeal_window_closed"
            ? "appeal.windowClosed"
            : code === "invalid_request"
              ? "appeal.tooShort"
              : "appeal.error",
        ),
      );
    }
  };

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="my-moderation-heading" className="panel">
      <h2 id="my-moderation-heading">{translate(locale, "appeal.title")}</h2>
      <p className="field-help">{translate(locale, "appeal.help")}</p>
      {items.map((item) => (
        <article className="review-item" key={item.id}>
          <h3>
            {item.eventTitle}: {translate(locale, `appeal.action.${item.action}`)}
          </h3>
          <p className="field-help">
            {formatDateTime(locale, item.createdAt, "Europe/Stockholm")}
            {item.reason ? ` · ${item.reason}` : ""}
          </p>
          {item.appeal ? (
            <p>
              {translate(locale, `appeal.state.${item.appeal.state}`)}
              {item.appeal.decisionReason ? ` · ${item.appeal.decisionReason}` : ""}
              {item.appeal.independent === false
                ? ` ${translate(locale, "appeal.notIndependent")}`
                : ""}
            </p>
          ) : (
            <form className="details-form" onSubmit={(formEvent) => void appeal(item, formEvent)}>
              <label htmlFor={`appeal-${item.id}`}>{translate(locale, "appeal.statement")}</label>
              <textarea
                id={`appeal-${item.id}`}
                maxLength={1000}
                minLength={10}
                name="statement"
                required
              />
              <button className="secondary-button" type="submit">
                {translate(locale, "appeal.submit")}
              </button>
            </form>
          )}
        </article>
      ))}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
