import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { wallTimeToIso } from "../lib/wall-time";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// Live-event controls: owners cancel a published event; owners and co-hosts
// end a live event early. Drafts use EventControls instead.
export function EventLifecycle({
  event,
  locale,
  onChanged,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onChanged: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [confirmTitle, setConfirmTitle] = useState("");
  const [reason, setReason] = useState("");

  const teamLead = event.role === "owner" || event.role === "co_host";
  const canCancel =
    event.role === "owner" && (event.state === "published" || event.state === "postponed");
  const canEnd = event.state === "active" && teamLead;
  const canPostpone = teamLead && (event.state === "published" || event.state === "active");
  const canReschedule = teamLead && event.state === "postponed";
  if (!canCancel && !canEnd && !canPostpone && !canReschedule) return null;

  const runPostponement = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const token = data.session.user.id;
    setBusy(true);
    setStatus("");
    try {
      if (canReschedule) {
        await api.rescheduleEvent(token, event.id, {
          endsAt: wallTimeToIso(String(form.get("endsAt") ?? ""), event.timezone),
          expectedEventVersion: event.version,
          startsAt: wallTimeToIso(String(form.get("startsAt") ?? ""), event.timezone),
        });
        setStatus(translate(locale, "lifecycle.rescheduled"));
      } else {
        await api.postponeEvent(token, event.id, {
          expectedEventVersion: event.version,
          publicReason: String(form.get("postponeReason") ?? "").trim(),
        });
        setStatus(translate(locale, "lifecycle.postponed"));
      }
      await onChanged();
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "recent_auth_required"
            ? "lifecycle.recentAuthAny"
            : code === "invalid_replacement_date"
              ? "lifecycle.invalidReplacement"
              : code === "reschedule_window_closed"
                ? "lifecycle.rescheduleClosed"
                : code === "version_conflict"
                  ? "event.versionConflict"
                  : "lifecycle.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: "cancel" | "end") => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const token = data.session.user.id;
    setBusy(true);
    setStatus("");
    try {
      if (action === "cancel") {
        await api.cancelEvent(token, event.id, {
          confirmTitle: confirmTitle.trim(),
          expectedEventVersion: event.version,
          publicReason: reason.trim(),
        });
      } else {
        await api.endEventEarly(token, event.id, event.version);
      }
      setStatus(translate(locale, action === "cancel" ? "lifecycle.cancelled" : "lifecycle.ended"));
      await onChanged();
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "recent_auth_required"
            ? "lifecycle.recentAuth"
            : code === "version_conflict"
              ? "event.versionConflict"
              : "lifecycle.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card asChild>
      <section aria-labelledby="lifecycle-heading">
        <CardHeader>
          <CardTitle id="lifecycle-heading">{translate(locale, "lifecycle.title")}</CardTitle>
        </CardHeader>
        <CardContent className="gap-5">
          {canEnd ? (
            <div className="grid justify-items-start gap-3">
              <p className="leading-relaxed text-muted-foreground">
                {translate(locale, "lifecycle.endHelp")}
              </p>
              <Button
                disabled={busy}
                onClick={() => void run("end")}
                type="button"
                variant="destructive"
              >
                {translate(locale, "lifecycle.end")}
              </Button>
            </div>
          ) : canCancel ? (
            <details className={dangerDetails}>
              <summary>{translate(locale, "lifecycle.cancel")}</summary>
              <form
                className={dangerBody}
                onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
                  formEvent.preventDefault();
                  void run("cancel");
                }}
              >
                <p className="leading-relaxed">{translate(locale, "lifecycle.cancelHelp")}</p>
                <Field>
                  <Label htmlFor="cancel-reason">{translate(locale, "lifecycle.reason")}</Label>
                  <Textarea
                    id="cancel-reason"
                    maxLength={500}
                    minLength={3}
                    onChange={(inputEvent) => setReason(inputEvent.currentTarget.value)}
                    required
                    value={reason}
                  />
                </Field>
                <Field>
                  <Label htmlFor="cancel-title">
                    {translate(locale, "event.deleteConfirmation")}
                  </Label>
                  <Input
                    autoComplete="off"
                    id="cancel-title"
                    onChange={(inputEvent) => setConfirmTitle(inputEvent.currentTarget.value)}
                    placeholder={event.title}
                    required
                    value={confirmTitle}
                  />
                </Field>
                <Button
                  className="justify-self-start"
                  disabled={busy || confirmTitle.trim() !== event.title || reason.trim().length < 3}
                  type="submit"
                  variant="destructive"
                >
                  {translate(locale, "lifecycle.confirmCancel")}
                </Button>
              </form>
            </details>
          ) : null}
          {canPostpone || canReschedule ? (
            <details className={dangerDetails}>
              <summary>
                {translate(locale, canReschedule ? "lifecycle.reschedule" : "lifecycle.postpone")}
              </summary>
              <form
                className={dangerBody}
                onSubmit={(formEvent) => void runPostponement(formEvent)}
              >
                <p className="leading-relaxed">
                  {translate(
                    locale,
                    canReschedule ? "lifecycle.rescheduleHelp" : "lifecycle.postponeHelp",
                  )}
                </p>
                {canReschedule ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <Label htmlFor="reschedule-start">
                        {translate(locale, "dashboard.startsAt")}
                      </Label>
                      <Input id="reschedule-start" name="startsAt" required type="datetime-local" />
                    </Field>
                    <Field>
                      <Label htmlFor="reschedule-end">
                        {translate(locale, "dashboard.endsAt")}
                      </Label>
                      <Input id="reschedule-end" name="endsAt" required type="datetime-local" />
                    </Field>
                  </div>
                ) : (
                  <Field>
                    <Label htmlFor="postpone-reason">{translate(locale, "lifecycle.reason")}</Label>
                    <Textarea
                      id="postpone-reason"
                      maxLength={500}
                      minLength={3}
                      name="postponeReason"
                      required
                    />
                  </Field>
                )}
                <Button
                  className="justify-self-start"
                  disabled={busy}
                  type="submit"
                  variant="destructive"
                >
                  {translate(
                    locale,
                    canReschedule ? "lifecycle.confirmReschedule" : "lifecycle.confirmPostpone",
                  )}
                </Button>
              </form>
            </details>
          ) : null}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}

const dangerDetails =
  "border-t pt-5 first:border-t-0 first:pt-0 [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:font-semibold [&>summary]:text-destructive-foreground";

const dangerBody =
  "mt-3 grid max-w-xl gap-3 rounded-xl border border-destructive/40 bg-destructive-soft p-4 text-destructive-foreground";
