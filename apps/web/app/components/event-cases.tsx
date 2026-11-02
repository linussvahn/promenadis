import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { ModerationCase } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;

// Event-scoped report cases. Reporter identity and contact are never shown;
// a quarantined location needs an explicit restore or uphold.
export function EventCases({
  call,
  eventId,
  locale,
  onChanged,
  timezone,
}: {
  readonly call: () => Promise<{ api: ApiClient; token: string } | null>;
  readonly eventId: string;
  readonly locale: Locale;
  readonly onChanged: () => Promise<void>;
  readonly timezone: string;
}) {
  const [cases, setCases] = useState<ModerationCase[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const client = await call();
    if (!client) return;
    try {
      setCases(await client.api.listEventCases(client.token, eventId));
    } catch {
      setStatus(translate(locale, "cases.error"));
    }
  }, [call, eventId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (item: ModerationCase, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = (submitter?.value ?? "dismiss") as "restore" | "uphold" | "dismiss";
    const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "").trim();
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      setCases(await client.api.reviewCase(client.token, item.id, { decision, reason }));
      await onChanged();
      setStatus(translate(locale, "cases.reviewed"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "platform_restricted"
            ? "cases.platformRestricted"
            : code === "invalid_request"
              ? "cases.reasonRequired"
              : "cases.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!cases) return null;
  const open = cases.filter((item) => item.state === "open");

  return (
    <section aria-labelledby="cases-heading" className="panel">
      <h2 id="cases-heading">{translate(locale, "cases.title")}</h2>
      <p className="field-help">{translate(locale, "cases.help")}</p>
      {open.length === 0 ? <p>{translate(locale, "cases.empty")}</p> : null}
      {open.map((item) => (
        <article className="review-item" key={item.id}>
          <h3>
            {item.sellerDisplayName ??
              item.addressLine ??
              translate(locale, `cases.subject.${item.subjectType}`)}
          </h3>
          {item.quarantined ? (
            <p className="notice notice-error">{translate(locale, "cases.quarantined")}</p>
          ) : null}
          <ul>
            {item.reports.map((report) => (
              <li key={report.id}>
                <strong>{translate(locale, `report.reason.${report.reason}`)}</strong>
                {report.relationship
                  ? ` · ${translate(locale, `report.relationship.${report.relationship}`)}`
                  : ""}{" "}
                · {formatDateTime(locale, report.createdAt, timezone)}
                <p>{report.details}</p>
              </li>
            ))}
          </ul>
          <form className="details-form" onSubmit={(formEvent) => void review(item, formEvent)}>
            <label htmlFor={`case-reason-${item.id}`}>{translate(locale, "cases.reason")}</label>
            <textarea id={`case-reason-${item.id}`} maxLength={500} name="reason" required />
            <div className="form-actions">
              {item.quarantined ? (
                <button className="secondary-button" disabled={busy} type="submit" value="restore">
                  {translate(locale, "cases.restore")}
                </button>
              ) : (
                <button className="secondary-button" disabled={busy} type="submit" value="dismiss">
                  {translate(locale, "cases.dismiss")}
                </button>
              )}
              <button className="danger-button" disabled={busy} type="submit" value="uphold">
                {translate(locale, item.subjectType === "item" ? "cases.hideItem" : "cases.uphold")}
              </button>
            </div>
          </form>
        </article>
      ))}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
