import type { createPromenadisApiClient } from "@promenadis/api-client";
import type { AdminOperations, SupportRequests } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Call = () => Promise<{ api: ApiClient; token: string } | null>;
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
  const [operations, setOperations] = useState<AdminOperations | null>(null);
  const [requests, setRequests] = useState<SupportRequests>([]);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    const client = await call();
    if (!client) return;
    try {
      setOperations(await client.api.getAdminOperations(client.token));
      setRequests(await client.api.listSupportRequests(client.token));
    } catch {
      setStatus(translate(locale, "admin.elevationExpired"));
    }
  }, [call, locale]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (key: string, enabled: boolean, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const client = await call();
    if (!client) return;
    try {
      const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "");
      setOperations(await client.api.setKillSwitch(client.token, key, enabled, reason));
      setStatus(translate(locale, "operations.switchSaved"));
    } catch {
      setStatus(translate(locale, "operations.switchFailed"));
    }
  };
  const resolve = async (id: string) => {
    const client = await call();
    if (!client) return;
    setRequests(await client.api.resolveSupportRequest(client.token, id));
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
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
