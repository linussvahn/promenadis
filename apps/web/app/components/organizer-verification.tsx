import { PromenadisApiError } from "@promenadis/api-client";
import type { OrganizerVerificationStatus } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { BadgeCheckIcon, ChevronRightIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

// Optional registered-organization badge for association/company organizers.
export function OrganizerVerification({
  locale,
  organizerProfileId,
}: {
  readonly locale: Locale;
  readonly organizerProfileId: string;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [verification, setVerification] = useState<OrganizerVerificationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const client = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  useEffect(() => {
    void (async () => {
      const authenticated = await client();
      if (!authenticated) return;
      try {
        setVerification(
          await authenticated.api.getOrganizerVerification(authenticated.token, organizerProfileId),
        );
      } catch {
        setStatus(translate(locale, "verification.error"));
      }
    })();
  }, [client, locale, organizerProfileId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const authenticated = await client();
    if (!authenticated) return;
    setBusy(true);
    setStatus("");
    try {
      setVerification(
        await authenticated.api.requestOrganizerVerification(
          authenticated.token,
          organizerProfileId,
          {
            controlMethod: String(form.get("controlMethod")) as
              | "organization_email"
              | "official_website"
              | "official_contact",
            controlReference: String(form.get("controlReference") ?? ""),
            organizationNumber: String(form.get("organizationNumber") ?? ""),
          },
        ),
      );
      setStatus(translate(locale, "verification.requested"));
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "invalid_organization_number"
            ? "verification.invalidNumber"
            : "verification.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!verification) return null;
  const canRequest = ["none", "rejected", "revoked"].includes(verification.status);
  const prefix = `verification-${organizerProfileId}`;
  return (
    <div className="grid gap-3">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-bold">
        {verification.badge ? (
          <BadgeCheckIcon aria-hidden="true" className="size-5 text-success-foreground" />
        ) : null}
        {translate(locale, "verification.title")}
      </h3>
      <p className={verification.badge ? "font-semibold text-success-foreground" : undefined}>
        {verification.badge
          ? `${translate(locale, "verification.badge")} ${verification.registeredName ?? ""}`
          : translate(locale, `verification.status.${verification.status}`)}
      </p>
      {verification.badge && verification.recheckDueAt ? (
        <FieldDescription>
          {translate(locale, "verification.recheck")}{" "}
          {formatDateTime(locale, verification.recheckDueAt, "Europe/Stockholm")}
        </FieldDescription>
      ) : null}
      {verification.reason ? (
        <Alert>
          <AlertDescription>
            {translate(locale, "publication.reviewReason")} {verification.reason}
          </AlertDescription>
        </Alert>
      ) : null}
      {canRequest ? (
        <details className="group rounded-xl border bg-muted/40 px-4 py-1">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 font-semibold text-link [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-90"
            />
            {translate(locale, "verification.request")}
          </summary>
          <form className="grid max-w-xl gap-4 pt-2 pb-4" onSubmit={submit}>
            <FieldDescription>{translate(locale, "verification.help")}</FieldDescription>
            <Field>
              <Label htmlFor={`${prefix}-number`}>{translate(locale, "verification.number")}</Label>
              <Input
                autoComplete="off"
                id={`${prefix}-number`}
                inputMode="numeric"
                maxLength={13}
                name="organizationNumber"
                placeholder="NNNNNN-NNNN"
                required
              />
            </Field>
            <Field>
              <Label htmlFor={`${prefix}-method`}>{translate(locale, "verification.method")}</Label>
              <NativeSelect
                defaultValue="official_website"
                id={`${prefix}-method`}
                name="controlMethod"
              >
                {(["official_website", "organization_email", "official_contact"] as const).map(
                  (method) => (
                    <NativeSelectOption key={method} value={method}>
                      {translate(locale, `verification.method.${method}`)}
                    </NativeSelectOption>
                  ),
                )}
              </NativeSelect>
            </Field>
            <Field>
              <Label htmlFor={`${prefix}-reference`}>
                {translate(locale, "verification.reference")}
              </Label>
              <Input
                id={`${prefix}-reference`}
                maxLength={200}
                minLength={3}
                name="controlReference"
                required
              />
            </Field>
            <div>
              <Button disabled={busy} type="submit" variant="outline">
                {translate(locale, "verification.submit")}
              </Button>
            </div>
          </form>
        </details>
      ) : null}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {status}
      </p>
    </div>
  );
}
