import { PromenadisApiError } from "@promenadis/api-client";
import type {
  AdminStatus,
  FirstEventReviewQueueItem,
  OrganizerVerificationQueueItem,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { AdminEventIntervention } from "./admin-event-intervention";
import { AdminModeration } from "./admin-moderation";
import { AdminOperationsPanel } from "./admin-operations";
import { PageHeading, PageMain } from "./page";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField, Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/** One queue item in an admin card: rows are split by the card's dividers. */
const adminRow = "grid gap-3 py-5 first:pt-0 last:pb-0";

export function AdminConsole() {
  return <AccountShell>{({ locale }) => <AdminContent locale={locale} />}</AccountShell>;
}

export function AdminContent({ locale }: { readonly locale: Locale }) {
  const { accessToken } = useAccountData();
  const [admin, setAdmin] = useState<AdminStatus | null>(null);
  const [queue, setQueue] = useState<FirstEventReviewQueueItem[]>([]);
  const [verifications, setVerifications] = useState<OrganizerVerificationQueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const call = useCallback(async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  }, [accessToken]);

  const load = useCallback(async () => {
    const client = await call();
    if (!client) return;
    try {
      const next = await client.api.getAdminStatus(client.token);
      setAdmin(next);
      setQueue(next.elevated ? await client.api.listFirstEventReviews(client.token) : []);
      setVerifications(
        next.elevated ? await client.api.listOrganizerVerifications(client.token) : [],
      );
    } catch {
      setStatus(translate(locale, "admin.error"));
    }
  }, [call, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const errorText = (error: unknown) => {
    const code = error instanceof PromenadisApiError ? error.code : null;
    return translate(
      locale,
      code === "mfa_failed"
        ? "admin.codeFailed"
        : code === "mfa_required"
          ? "admin.totpRequired"
          : code === "elevation_required"
            ? "admin.elevationExpired"
            : code === "conflict_of_interest"
              ? "admin.ownEvent"
              : code === "version_conflict" || code === "review_unavailable"
                ? "admin.reviewChanged"
                : "admin.error",
    );
  };

  const elevate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("adminCode") ?? "").trim();
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.startAdminElevation(client.token, code);
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const exit = async () => {
    const client = await call();
    if (!client) return;
    setBusy(true);
    try {
      setAdmin(await client.api.endAdminElevation(client.token));
      setQueue([]);
      setVerifications([]);
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (item: FirstEventReviewQueueItem, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value === "rejected" ? "rejected" : "approved";
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.decideFirstEventReview(client.token, item.eventId, {
        decision,
        expectedEventVersion: item.eventVersion,
        reason: String(form.get("reason") ?? ""),
      });
      setStatus(translate(locale, decision === "approved" ? "admin.approved" : "admin.rejected"));
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const decideVerification = async (
    item: OrganizerVerificationQueueItem,
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value === "rejected" ? "rejected" : "verified";
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      await client.api.decideOrganizerVerification(client.token, item.organizerProfileId, {
        controlConfirmed: form.get("controlConfirmed") === "on",
        decision,
        reason: String(form.get("reason") ?? "") || undefined,
        registeredName: String(form.get("registeredName") ?? "") || undefined,
        registryActive: form.get("registryActive") === "on",
      });
      setStatus(translate(locale, decision === "verified" ? "admin.verified" : "admin.rejected"));
      await load();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageMain>
      <PageHeading eyebrow="Promenadis" title={translate(locale, "admin.title")} />
      {!admin ? (
        <p aria-live="polite" className="text-muted-foreground">
          {status || translate(locale, "common.loading")}
        </p>
      ) : !admin.eligible ? (
        <Alert>{translate(locale, "admin.notEligible")}</Alert>
      ) : !admin.elevated ? (
        <Card asChild className="max-w-xl">
          <form onSubmit={elevate}>
            <CardContent>
              <p>{translate(locale, "admin.elevateHelp")}</p>
              <Field>
                <Label htmlFor="admin-code">{translate(locale, "mfa.code")}</Label>
                <Input
                  autoComplete="one-time-code"
                  id="admin-code"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="adminCode"
                  pattern="[0-9]{6}"
                  required
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={busy} type="submit">
                  {translate(locale, "admin.elevate")}
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      ) : (
        <>
          <Alert
            className="flex max-w-none flex-wrap items-center gap-x-2 gap-y-3"
            role="status"
            variant="warning"
          >
            <strong>{translate(locale, "admin.active")}</strong>{" "}
            {admin.expiresAt
              ? `${translate(locale, "admin.until")} ${formatDateTime(locale, admin.expiresAt, "Europe/Stockholm")}`
              : null}{" "}
            <Button
              className="sm:ms-auto"
              disabled={busy}
              onClick={() => void exit()}
              size="sm"
              type="button"
              variant="outline"
            >
              {translate(locale, "admin.exit")}
            </Button>
          </Alert>
          <Card aria-labelledby="review-queue-heading" asChild>
            <section>
              <CardHeader>
                <CardTitle id="review-queue-heading">
                  {translate(locale, "admin.queueTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="gap-0 divide-y">
                {queue.length === 0 ? (
                  <p className="text-muted-foreground">{translate(locale, "admin.queueEmpty")}</p>
                ) : null}
                {queue.map((item) => (
                  <article className={adminRow} key={item.eventId}>
                    <h3 className="text-lg font-bold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {item.organizerName} ·{" "}
                      {translate(locale, `organizerType.${item.organizerType}`)} ·{" "}
                      {translate(locale, `visibility.${item.visibility}`)}
                    </p>
                    {item.description ? <p>{item.description}</p> : null}
                    <p className="text-sm text-muted-foreground">
                      {translate(locale, "admin.requestedAt")}{" "}
                      {formatDateTime(locale, item.requestedAt, "Europe/Stockholm")}
                    </p>
                    {item.ownEvent ? (
                      <Alert>{translate(locale, "admin.ownEvent")}</Alert>
                    ) : !item.current ? (
                      <Alert>{translate(locale, "admin.reviewChanged")}</Alert>
                    ) : (
                      <form
                        className="grid max-w-xl gap-4"
                        onSubmit={(event) => void decide(item, event)}
                      >
                        <Field>
                          <Label htmlFor={`reason-${item.eventId}`}>
                            {translate(locale, "admin.reason")}
                          </Label>
                          <Textarea
                            id={`reason-${item.eventId}`}
                            maxLength={500}
                            minLength={3}
                            name="reason"
                            required
                          />
                        </Field>
                        <div className="flex flex-wrap items-center gap-3">
                          <Button disabled={busy} type="submit" value="approved">
                            {translate(locale, "admin.approve")}
                          </Button>
                          <Button
                            disabled={busy}
                            type="submit"
                            value="rejected"
                            variant="destructive"
                          >
                            {translate(locale, "admin.reject")}
                          </Button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
              </CardContent>
            </section>
          </Card>
          <Card aria-labelledby="verification-queue-heading" asChild>
            <section>
              <CardHeader>
                <CardTitle id="verification-queue-heading">
                  {translate(locale, "admin.verificationTitle")}
                </CardTitle>
                <CardDescription>{translate(locale, "admin.verificationHelp")}</CardDescription>
              </CardHeader>
              <CardContent className="gap-0 divide-y">
                {verifications.length === 0 ? (
                  <p className="text-muted-foreground">
                    {translate(locale, "admin.verificationEmpty")}
                  </p>
                ) : null}
                {verifications.map((item) => (
                  <article className={adminRow} key={item.organizerProfileId}>
                    <h3 className="text-lg font-bold">{item.displayName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {item.organizationNumber} ·{" "}
                      {translate(locale, `organizerType.${item.organizerType}`)}
                    </p>
                    <p className="break-words">
                      {translate(locale, `verification.method.${item.controlMethod}`)}:{" "}
                      {item.controlReference}
                    </p>
                    {item.ownOrganizer ? (
                      <Alert>{translate(locale, "admin.ownOrganizer")}</Alert>
                    ) : (
                      <form
                        className="grid max-w-xl gap-4"
                        onSubmit={(event) => void decideVerification(item, event)}
                      >
                        <Field>
                          <Label htmlFor={`registered-${item.organizerProfileId}`}>
                            {translate(locale, "admin.registeredName")}
                          </Label>
                          <Input
                            id={`registered-${item.organizerProfileId}`}
                            maxLength={200}
                            name="registeredName"
                          />
                        </Field>
                        <ChoiceField>
                          <Checkbox name="registryActive" />
                          <span>{translate(locale, "admin.registryActive")}</span>
                        </ChoiceField>
                        <ChoiceField>
                          <Checkbox name="controlConfirmed" />
                          <span>{translate(locale, "admin.controlConfirmed")}</span>
                        </ChoiceField>
                        <Field>
                          <Label htmlFor={`verification-reason-${item.organizerProfileId}`}>
                            {translate(locale, "admin.reason")}
                          </Label>
                          <Textarea
                            id={`verification-reason-${item.organizerProfileId}`}
                            maxLength={500}
                            name="reason"
                          />
                        </Field>
                        <div className="flex flex-wrap items-center gap-3">
                          <Button disabled={busy} type="submit" value="verified">
                            {translate(locale, "admin.verify")}
                          </Button>
                          <Button
                            disabled={busy}
                            type="submit"
                            value="rejected"
                            variant="destructive"
                          >
                            {translate(locale, "admin.reject")}
                          </Button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
              </CardContent>
            </section>
          </Card>
          <AdminEventIntervention call={call} locale={locale} />
          <AdminModeration call={call} locale={locale} />
          <AdminOperationsPanel call={call} locale={locale} />
        </>
      )}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {status}
      </p>
    </PageMain>
  );
}
