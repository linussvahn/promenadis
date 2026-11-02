import { PromenadisApiError } from "@promenadis/api-client";
import type { SubmitReportRequest } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { getPromenadisApiClient } from "../lib/supabase";
import { PageHeader } from "./page-header";

const reasons = [
  "unauthorized_address",
  "safety",
  "illegal",
  "copyright",
  "privacy",
  "fraud",
  "harassment",
  "other_terms",
] as const;

export function ReportPage() {
  const { locale, setLocale } = useStoredLocale();
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {translate(locale, "home.skip")}
      </a>
      <PageHeader locale={locale} onLocaleChange={setLocale} />
      <ReportForm locale={locale} />
    </div>
  );
}

// Anonymous structured report about one location, seller or item. The page
// never tells the reporter what happened to the subject.
export function ReportForm({ locale }: { readonly locale: Locale }) {
  const [params] = useSearchParams();
  // Links from the public map carry the event key and opaque public IDs.
  const eventKey = params.get("key") ?? "";
  const eventId = params.get("event") ?? "";
  const subjectType = params.get("type") as SubmitReportRequest["subjectType"] | null;
  const subjectId = params.get("subject") ?? "";
  const [reason, setReason] = useState<(typeof reasons)[number]>("unauthorized_address");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState("");

  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const api = getPromenadisApiClient();
    if (!api || !subjectType) return;
    const form = new FormData(formEvent.currentTarget);
    setBusy(true);
    setStatus("");
    try {
      const report = {
        confirmsNoConsent: form.get("confirmsNoConsent") === "on",
        details: String(form.get("details") ?? ""),
        reason,
        relationship:
          reason === "unauthorized_address"
            ? (String(form.get("relationship") ?? "other") as SubmitReportRequest["relationship"])
            : null,
        reporterContact: String(form.get("contact") ?? "").trim(),
        website: String(form.get("website") ?? ""),
      };
      if (eventKey && subjectType !== "item") {
        await api.submitPublicReport({
          ...report,
          eventKey,
          publicSubjectId: subjectId,
          subjectType,
        });
      } else {
        await api.submitReport({ ...report, eventId, subjectId, subjectType });
      }
      setSent(true);
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "rate_limited"
            ? "report.rateLimited"
            : error instanceof PromenadisApiError && error.code === "not_found"
              ? "report.notFound"
              : "report.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  if (
    !(eventId || eventKey) ||
    !subjectId ||
    !(eventKey ? ["location", "participation"] : ["location", "participation", "item"]).includes(
      subjectType ?? "",
    )
  ) {
    return (
      <main className="account-page" id="main">
        <p className="notice notice-error">{translate(locale, "report.badLink")}</p>
      </main>
    );
  }

  return (
    <main className="account-page flow-page" id="main" tabIndex={-1}>
      <header className="app-heading flow-heading">
        <p className="eyebrow">Promenadis</p>
        <h1>{translate(locale, "report.title")}</h1>
        <p className="lede">{translate(locale, "report.intro")}</p>
      </header>
      {sent ? (
        <p className="notice" role="status">
          {translate(locale, "report.received")}
        </p>
      ) : (
        <form className="panel form-panel" onSubmit={submit}>
          <label htmlFor="report-reason">{translate(locale, "report.reason")}</label>
          <select
            id="report-reason"
            onChange={(event) => setReason(event.currentTarget.value as (typeof reasons)[number])}
            value={reason}
          >
            {reasons.map((value) => (
              <option key={value} value={value}>
                {translate(locale, `report.reason.${value}`)}
              </option>
            ))}
          </select>
          {reason === "unauthorized_address" ? (
            <>
              <label htmlFor="report-relationship">
                {translate(locale, "report.relationship")}
              </label>
              <select defaultValue="resident" id="report-relationship" name="relationship">
                {(["resident", "owner", "manager", "other"] as const).map((value) => (
                  <option key={value} value={value}>
                    {translate(locale, `report.relationship.${value}`)}
                  </option>
                ))}
              </select>
              <label className="checkbox-field">
                <input name="confirmsNoConsent" type="checkbox" />
                <span>{translate(locale, "report.confirmsNoConsent")}</span>
              </label>
            </>
          ) : null}
          <label htmlFor="report-details">{translate(locale, "report.details")}</label>
          <textarea id="report-details" maxLength={1000} name="details" required rows={5} />
          <label htmlFor="report-contact">{translate(locale, "report.contact")}</label>
          <input autoComplete="email" id="report-contact" maxLength={200} name="contact" />
          <p className="field-help">{translate(locale, "report.contactHelp")}</p>
          <div aria-hidden="true" className="visually-hidden">
            <label htmlFor="report-website">Website</label>
            <input autoComplete="off" id="report-website" name="website" tabIndex={-1} />
          </div>
          <button className="primary-button" disabled={busy} type="submit">
            {translate(locale, "report.submit")}
          </button>
          <p aria-live="polite" className="form-status">
            {status}
          </p>
        </form>
      )}
    </main>
  );
}
