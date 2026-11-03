import type { createPromenadisApiClient } from "@promenadis/api-client";
import type { AdminOperations, SupportRequests } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { accountKey } from "../lib/use-account-data";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Call = () => Promise<{ api: ApiClient; token: string } | null>;
type Client = NonNullable<Awaited<ReturnType<Call>>>;
const switches = [
  "public_locations",
  "seller_applications",
  "organizer_relay",
  "exports",
  "support_forms",
] as const;

// Elevated-only: job health, incident switches and the support inbox.
export function AdminOperationsPanel({
  call,
  locale,
}: {
  readonly call: Call;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const accountId = useExpectedAccountId();
  const operationsKey = accountKey(accountId, "admin", "operations");
  const requestsKey = accountKey(accountId, "admin", "support-requests");
  const [status, setStatus] = useState("");

  const operationsQuery = useQuery({
    queryKey: operationsKey,
    queryFn: async (): Promise<AdminOperations | null> => {
      const client = await call();
      return client ? client.api.getAdminOperations(client.token) : null;
    },
  });
  const operations = operationsQuery.data ?? null;
  // The support inbox is read only after job health loaded, as before.
  const requestsQuery = useQuery({
    enabled: operations !== null,
    queryKey: requestsKey,
    queryFn: async (): Promise<SupportRequests> => {
      const client = await call();
      return client ? client.api.listSupportRequests(client.token) : [];
    },
  });
  const requests = requestsQuery.data ?? [];

  const toggleMutation = useMutation({
    mutationFn: ({
      api,
      token,
      key,
      enabled,
      reason,
    }: Client & { key: string; enabled: boolean; reason: string }) =>
      api.setKillSwitch(token, key, enabled, reason),
    onSuccess: (next) => {
      queryClient.setQueryData(operationsKey, next);
      setStatus(translate(locale, "operations.switchSaved"));
    },
    onError: () => setStatus(translate(locale, "operations.switchFailed")),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ api, token, id }: Client & { id: string }) =>
      api.resolveSupportRequest(token, id),
    onSuccess: (next) => queryClient.setQueryData(requestsKey, next),
  });

  const shownStatus =
    status ||
    (operationsQuery.isError || requestsQuery.isError
      ? translate(locale, "admin.elevationExpired")
      : "");

  const toggle = async (key: string, enabled: boolean, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "");
    const client = await call();
    if (!client) return;
    toggleMutation.mutate({ ...client, enabled, key, reason });
  };
  const resolve = async (id: string) => {
    const client = await call();
    if (!client) return;
    resolveMutation.mutate({ ...client, id });
  };
  if (!operations) return null;
  return (
    <Card aria-labelledby="operations-heading" asChild>
      <section>
        <CardHeader>
          <CardTitle id="operations-heading">{translate(locale, "operations.title")}</CardTitle>
        </CardHeader>
        <CardContent className="gap-6">
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {(
              ["publicSnapshots", "eventLifecycle", "eventRetention", "notificationQueue"] as const
            ).map((check) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-4 py-3 text-sm"
                key={check}
              >
                {translate(locale, `operations.check.${check}`)}:{" "}
                <Badge asChild variant={operations[check] ? "success" : "destructive"}>
                  <strong>
                    {translate(locale, operations[check] ? "operations.ok" : "operations.late")}
                  </strong>
                </Badge>
              </li>
            ))}
          </ul>
          <div className="grid gap-3">
            <h3 className="text-lg font-bold">{translate(locale, "operations.switches")}</h3>
            <div className="grid divide-y">
              {switches.map((key) => {
                const on = operations.switches[key] ?? false;
                return (
                  <form
                    className="grid gap-3 py-4 first:pt-0 last:pb-0"
                    key={key}
                    onSubmit={(formEvent) => void toggle(key, !on, formEvent)}
                  >
                    <p className="flex flex-wrap items-center gap-2">
                      <strong>{translate(locale, `operations.switch.${key}`)}</strong> ·{" "}
                      <Badge variant={on ? "destructive" : "success"}>
                        {translate(locale, on ? "operations.paused" : "operations.running")}
                      </Badge>
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field className="min-w-0 flex-1 basis-56">
                        <Label htmlFor={`switch-${key}`}>
                          {translate(locale, "walking.reason")}
                        </Label>
                        <Input
                          id={`switch-${key}`}
                          maxLength={500}
                          minLength={3}
                          name="reason"
                          required
                        />
                      </Field>
                      <Button type="submit" variant={on ? "outline" : "destructive"}>
                        {translate(locale, on ? "operations.resume" : "operations.pause")}
                      </Button>
                    </div>
                  </form>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3">
            <h3 className="text-lg font-bold">{translate(locale, "operations.support")}</h3>
            {requests.length === 0 ? (
              <p className="text-muted-foreground">{translate(locale, "operations.noSupport")}</p>
            ) : null}
            <ul className="m-0 grid list-none divide-y p-0">
              {requests.map((item) => (
                <li className="grid gap-2 py-4 first:pt-0 last:pb-0" key={item.id}>
                  <p className="text-sm text-muted-foreground">
                    {translate(locale, `support.topic.${item.topic}`)} ·{" "}
                    {formatDateTime(locale, item.createdAt, "Europe/Stockholm")}
                    {item.hasContact ? ` · ${translate(locale, "operations.hasContact")}` : ""}
                  </p>
                  <p className="break-words whitespace-pre-wrap">{item.body}</p>
                  {item.resolvedAt ? (
                    <Badge variant="secondary">{translate(locale, "operations.resolved")}</Badge>
                  ) : (
                    <Button
                      className="justify-self-start"
                      onClick={() => void resolve(item.id)}
                      type="button"
                      variant="link"
                    >
                      {translate(locale, "operations.resolve")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
            {shownStatus}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
