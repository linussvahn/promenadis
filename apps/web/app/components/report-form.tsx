import { PromenadisApiError } from "@promenadis/api-client";
import type { SubmitReportRequest } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { getPromenadisApiClient } from "../lib/supabase";
import { PageHeading, PageMain, siteShell, skipLink } from "./page";
import { PageHeader } from "./page-header";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField, Field, FieldDescription, FieldGroup } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

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
    <div className={siteShell}>
      <a className={skipLink} href="#main">
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
      <PageMain width="flow">
        <Alert variant="destructive">{translate(locale, "report.badLink")}</Alert>
      </PageMain>
    );
  }

  return (
    <PageMain width="flow">
      <PageHeading
        description={translate(locale, "report.intro")}
        eyebrow="Promenadis"
        title={translate(locale, "report.title")}
      />
      {sent ? (
        <Alert role="status" variant="success">
          {translate(locale, "report.received")}
        </Alert>
      ) : (
        <Card asChild className="max-w-2xl">
          <form onSubmit={submit}>
            <CardContent>
              <FieldGroup>
                <Field>
                  <Label htmlFor="report-reason">{translate(locale, "report.reason")}</Label>
                  <NativeSelect
                    id="report-reason"
                    onChange={(event) =>
                      setReason(event.currentTarget.value as (typeof reasons)[number])
                    }
                    value={reason}
                  >
                    {reasons.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {translate(locale, `report.reason.${value}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {reason === "unauthorized_address" ? (
                  <>
                    <Field>
                      <Label htmlFor="report-relationship">
                        {translate(locale, "report.relationship")}
                      </Label>
                      <NativeSelect
                        defaultValue="resident"
                        id="report-relationship"
                        name="relationship"
                      >
                        {(["resident", "owner", "manager", "other"] as const).map((value) => (
                          <NativeSelectOption key={value} value={value}>
                            {translate(locale, `report.relationship.${value}`)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <ChoiceField>
                      <Checkbox name="confirmsNoConsent" />
                      <span>{translate(locale, "report.confirmsNoConsent")}</span>
                    </ChoiceField>
                  </>
                ) : null}
                <Field>
                  <Label htmlFor="report-details">{translate(locale, "report.details")}</Label>
                  <Textarea id="report-details" maxLength={1000} name="details" required rows={5} />
                </Field>
                <Field>
                  <Label htmlFor="report-contact">{translate(locale, "report.contact")}</Label>
                  <Input autoComplete="email" id="report-contact" maxLength={200} name="contact" />
                  <FieldDescription>{translate(locale, "report.contactHelp")}</FieldDescription>
                </Field>
                <div aria-hidden="true" className="sr-only">
                  <label htmlFor="report-website">Website</label>
                  <input autoComplete="off" id="report-website" name="website" tabIndex={-1} />
                </div>
              </FieldGroup>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={busy} type="submit">
                  {translate(locale, "report.submit")}
                </Button>
              </div>
              <p aria-live="polite" className="min-h-6 text-sm font-semibold">
                {status}
              </p>
            </CardContent>
          </form>
        </Card>
      )}
    </PageMain>
  );
}
