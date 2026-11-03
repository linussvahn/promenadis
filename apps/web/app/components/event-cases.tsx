import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { ModerationCase } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { accountKey } from "../lib/use-account-data";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Client = { readonly api: ApiClient; readonly token: string };
type Decision = "restore" | "uphold" | "dismiss";

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
  const queryClient = useQueryClient();
  const casesKey = accountKey(useExpectedAccountId(), "events", eventId, "cases");
  const [status, setStatus] = useState("");

  const casesQuery = useQuery({
    queryKey: casesKey,
    queryFn: async (): Promise<ModerationCase[] | null> => {
      const client = await call();
      return client ? client.api.listEventCases(client.token, eventId) : null;
    },
  });
  const cases = casesQuery.data ?? null;

  const reviewMutation = useMutation({
    mutationFn: ({
      api,
      token,
      item,
      decision,
      reason,
    }: Client & { item: ModerationCase; decision: Decision; reason: string }) =>
      api.reviewCase(token, item.id, { decision, reason }),
    onSuccess: async (next) => {
      queryClient.setQueryData(casesKey, next);
      await onChanged();
      setStatus(translate(locale, "cases.reviewed"));
    },
    onError: (error) => {
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
    },
  });
  const busy = reviewMutation.isPending;

  const review = async (item: ModerationCase, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const submitter = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = (submitter?.value ?? "dismiss") as Decision;
    const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "").trim();
    const client = await call();
    if (!client) return;
    setStatus("");
    reviewMutation.mutate({ ...client, decision, item, reason });
  };

  if (!cases) return null;
  const open = cases.filter((item) => item.state === "open");

  return (
    <Card aria-labelledby="cases-heading" asChild>
      <section>
        <CardHeader>
          <CardTitle id="cases-heading">{translate(locale, "cases.title")}</CardTitle>
          <CardDescription>{translate(locale, "cases.help")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-0 divide-y">
          {open.length === 0 ? (
            <p className="text-muted-foreground">{translate(locale, "cases.empty")}</p>
          ) : null}
          {open.map((item) => (
            <article className="grid gap-3 py-5 first:pt-0 last:pb-0" key={item.id}>
              <h3 className="text-lg font-bold break-words">
                {item.sellerDisplayName ??
                  item.addressLine ??
                  translate(locale, `cases.subject.${item.subjectType}`)}
              </h3>
              {item.quarantined ? (
                <Alert variant="destructive">{translate(locale, "cases.quarantined")}</Alert>
              ) : null}
              <ul className="m-0 grid list-none gap-3 p-0">
                {item.reports.map((report) => (
                  <li className="grid gap-1 rounded-xl bg-muted p-4 text-sm" key={report.id}>
                    <span>
                      <strong>{translate(locale, `report.reason.${report.reason}`)}</strong>
                      {report.relationship
                        ? ` · ${translate(locale, `report.relationship.${report.relationship}`)}`
                        : ""}{" "}
                      · {formatDateTime(locale, report.createdAt, timezone)}
                    </span>
                    <p className="text-base break-words">{report.details}</p>
                  </li>
                ))}
              </ul>
              <form
                className="grid max-w-xl gap-4"
                onSubmit={(formEvent) => void review(item, formEvent)}
              >
                <Field>
                  <Label htmlFor={`case-reason-${item.id}`}>
                    {translate(locale, "cases.reason")}
                  </Label>
                  <Textarea id={`case-reason-${item.id}`} maxLength={500} name="reason" required />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  {item.quarantined ? (
                    <Button disabled={busy} type="submit" value="restore" variant="outline">
                      {translate(locale, "cases.restore")}
                    </Button>
                  ) : (
                    <Button disabled={busy} type="submit" value="dismiss" variant="outline">
                      {translate(locale, "cases.dismiss")}
                    </Button>
                  )}
                  <Button disabled={busy} type="submit" value="uphold" variant="destructive">
                    {translate(
                      locale,
                      item.subjectType === "item" ? "cases.hideItem" : "cases.uphold",
                    )}
                  </Button>
                </div>
              </form>
            </article>
          ))}
          <p aria-live="polite" className="min-h-6 pt-4 text-sm font-semibold">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
