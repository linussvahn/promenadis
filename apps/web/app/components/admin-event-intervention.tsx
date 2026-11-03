import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { AdminEventSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { accountKey } from "../lib/use-account-data";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Client = { readonly api: ApiClient; readonly token: string };
type InterventionInput = Parameters<ApiClient["interveneInEvent"]>[2];

// Protective admin path: look up one event by id, then cancel it while
// published or end it while live. Both need an internal reason for the audit.
export function AdminEventIntervention({
  call,
  locale,
}: {
  readonly call: () => Promise<{ api: ApiClient; token: string } | null>;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const accountId = useExpectedAccountId();
  const [lookupId, setLookupId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const eventKey = accountKey(accountId, "admin", "event", lookupId);

  const errorText = (error: unknown) => {
    const code = error instanceof PromenadisApiError ? error.code : null;
    return translate(
      locale,
      code === "not_found"
        ? "admin.eventNotFound"
        : code === "elevation_required"
          ? "admin.elevationExpired"
          : code === "version_conflict" || code === "invalid_state"
            ? "admin.reviewChanged"
            : "admin.error",
    );
  };

  // Looking up is a read of one event; a not-found id is not retried.
  const eventQuery = useQuery({
    enabled: lookupId !== null,
    queryKey: eventKey,
    queryFn: async (): Promise<AdminEventSummary | null> => {
      const client = await call();
      return client && lookupId ? client.api.getAdminEvent(client.token, lookupId) : null;
    },
    retry: false,
  });
  const event = eventQuery.data ?? null;

  const interveneMutation = useMutation({
    mutationFn: ({
      api,
      token,
      target,
      input,
    }: Client & { target: AdminEventSummary; input: InterventionInput }) =>
      api.interveneInEvent(token, target.id, input),
    onSuccess: (result, { target }) => {
      const changed: AdminEventSummary = {
        ...target,
        state: result.state,
        version: result.version,
      };
      queryClient.setQueryData(accountKey(accountId, "admin", "event", target.id), changed);
      setStatus(translate(locale, "admin.intervened"));
    },
    onError: (error) => setStatus(errorText(error)),
    retry: false,
  });

  const busy = eventQuery.isFetching || interveneMutation.isPending;
  const shownStatus = status || (eventQuery.isError ? errorText(eventQuery.error) : "");

  const lookup = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const eventId = String(new FormData(formEvent.currentTarget).get("eventId") ?? "").trim();
    const client = await call();
    if (!client) return;
    setStatus("");
    if (eventId === lookupId) await eventQuery.refetch();
    else setLookupId(eventId);
  };

  const intervene = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!event) return;
    const form = new FormData(formEvent.currentTarget);
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value ?? "cancel";
    const internalReason = String(form.get("internalReason") ?? "");
    const publicReason = String(form.get("publicReason") ?? "");
    const client = await call();
    if (!client) return;
    setStatus("");
    interveneMutation.mutate({
      ...client,
      input:
        action === "end_early"
          ? { action: "end_early", expectedEventVersion: event.version, internalReason }
          : {
              action: action === "postpone" ? "postpone" : "cancel",
              expectedEventVersion: event.version,
              internalReason,
              publicReason,
            },
      target: event,
    });
  };

  const canCancel = event?.state === "published" || event?.state === "postponed";
  const canEnd = event?.state === "active";
  const canPostpone = event?.state === "published" || event?.state === "active";

  return (
    <Card aria-labelledby="admin-event-heading" asChild>
      <section>
        <CardHeader>
          <CardTitle id="admin-event-heading">{translate(locale, "admin.eventTitle")}</CardTitle>
          <CardDescription>{translate(locale, "admin.eventHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-5">
          <form className="flex max-w-xl flex-wrap items-center gap-2" onSubmit={lookup}>
            <label className="sr-only" htmlFor="admin-event-id">
              {translate(locale, "admin.eventId")}
            </label>
            <Input
              autoComplete="off"
              className="min-w-0 flex-1 basis-64"
              id="admin-event-id"
              name="eventId"
              pattern="[0-9a-fA-F-]{36}"
              placeholder={translate(locale, "admin.eventId")}
              required
            />
            <Button disabled={busy} type="submit" variant="outline">
              {translate(locale, "admin.lookup")}
            </Button>
          </form>
          {event ? (
            <article className="grid gap-3 border-t pt-5">
              <h3 className="text-lg font-bold">{event.title}</h3>
              <p className="text-sm text-muted-foreground">
                {event.organizerDisplayName} · {translate(locale, `event.state.${event.state}`)}
                {event.startsAt
                  ? ` · ${formatDateTime(locale, event.startsAt, event.timezone)}`
                  : null}
              </p>
              {canCancel || canEnd || canPostpone ? (
                <form className="grid max-w-xl gap-4" onSubmit={intervene}>
                  {canCancel || canPostpone ? (
                    <Field>
                      <Label htmlFor="admin-public-reason">
                        {translate(locale, "lifecycle.reason")}
                      </Label>
                      <Textarea
                        id="admin-public-reason"
                        maxLength={500}
                        minLength={3}
                        name="publicReason"
                      />
                    </Field>
                  ) : null}
                  <Field>
                    <Label htmlFor="admin-internal-reason">
                      {translate(locale, "admin.internalReason")}
                    </Label>
                    <Textarea
                      id="admin-internal-reason"
                      maxLength={500}
                      minLength={3}
                      name="internalReason"
                      required
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
                    {canEnd ? (
                      <Button disabled={busy} type="submit" value="end_early" variant="destructive">
                        {translate(locale, "lifecycle.end")}
                      </Button>
                    ) : null}
                    {canCancel ? (
                      <Button disabled={busy} type="submit" value="cancel" variant="destructive">
                        {translate(locale, "lifecycle.cancel")}
                      </Button>
                    ) : null}
                    {canPostpone ? (
                      <Button disabled={busy} type="submit" value="postpone" variant="outline">
                        {translate(locale, "lifecycle.postpone")}
                      </Button>
                    ) : null}
                  </div>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {translate(locale, "admin.noIntervention")}
                </p>
              )}
            </article>
          ) : null}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {shownStatus}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
