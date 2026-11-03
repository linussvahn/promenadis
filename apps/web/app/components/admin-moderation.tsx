import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type {
  AdminAccount,
  AdminApproval,
  AdminCase,
  AppealQueueItem,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { accountKey } from "../lib/use-account-data";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/** A queue item inside an admin card; the card's dividers separate rows. */
const row = "grid gap-3 py-5 first:pt-0 last:pb-0";
const rowForm = "grid max-w-xl gap-4";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Call = () => Promise<{ api: ApiClient; token: string } | null>;
type Client = NonNullable<Awaited<ReturnType<Call>>>;
interface ModerationLists {
  readonly appeals: readonly AppealQueueItem[];
  readonly approvals: readonly AdminApproval[];
  readonly cases: readonly AdminCase[];
}

const errorKeys = {
  different_approver_required: "adminModeration.differentApprover",
  different_reviewer_required: "adminModeration.differentReviewer",
  elevation_required: "admin.elevationExpired",
  not_found: "adminModeration.notFound",
  platform_restricted: "adminModeration.liftFirst",
  reason_required: "cases.reasonRequired",
} as const;

// Elevated-only: appeals, platform-wide report cases with reason-gated
// reporter contact, account restrictions and second-admin approvals.
export function AdminModeration({
  call,
  locale,
}: {
  readonly call: Call;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const listsKey = accountKey(useExpectedAccountId(), "admin", "moderation");
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");

  const listsQuery = useQuery({
    queryKey: listsKey,
    queryFn: async (): Promise<ModerationLists | null> => {
      const client = await call();
      if (!client) return null;
      const [appeals, cases, approvals] = await Promise.all([
        client.api.listAppeals(client.token),
        client.api.listAdminCases(client.token),
        client.api.listAdminApprovals(client.token),
      ]);
      return { appeals, approvals, cases };
    },
  });
  const appeals = listsQuery.data?.appeals ?? [];
  const cases = listsQuery.data?.cases ?? [];
  const approvals = listsQuery.data?.approvals ?? [];
  const setLists = (patch: Partial<ModerationLists>) =>
    queryClient.setQueryData<ModerationLists | null>(listsKey, (current) => ({
      appeals: [],
      approvals: [],
      cases: [],
      ...current,
      ...patch,
    }));

  // Each action reads or writes through the elevated session and updates
  // the cached lists itself; reporter contact and account lookups stay
  // component state so they are never cached.
  const actionMutation = useMutation({
    mutationFn: ({
      action,
      client,
    }: {
      action: (client: Client) => Promise<void>;
      client: Client;
    }) => action(client),
    onSuccess: () => setStatus(translate(locale, "adminModeration.saved")),
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(translate(locale, errorKeys[code as keyof typeof errorKeys] ?? "admin.error"));
    },
    retry: false,
  });

  const run = async (action: (client: Client) => Promise<void>) => {
    const client = await call();
    if (!client) return;
    setStatus("");
    actionMutation.mutate({ action, client });
  };
  const shownStatus = status || (listsQuery.isError ? translate(locale, "admin.error") : "");

  const reasonFrom = (formEvent: FormEvent<HTMLFormElement>) =>
    String(new FormData(formEvent.currentTarget).get("reason") ?? "").trim();

  return (
    <>
      <Card aria-labelledby="appeals-heading" asChild>
        <section>
          <CardHeader>
            <CardTitle id="appeals-heading">
              {translate(locale, "adminModeration.appeals")}
            </CardTitle>
          </CardHeader>
          <CardContent className="gap-0 divide-y">
            {appeals.length === 0 ? (
              <p className="text-muted-foreground">
                {translate(locale, "adminModeration.noAppeals")}
              </p>
            ) : null}
            {appeals.map((item) => (
              <article className={row} key={item.id}>
                <h3 className="text-lg font-bold">
                  {item.eventTitle}: {item.action}
                </h3>
                <p className="text-sm text-muted-foreground">{item.actionReason}</p>
                <blockquote className="border-s-4 border-primary/40 ps-4 italic">
                  {item.statement}
                </blockquote>
                {item.ownDecision ? (
                  <Alert>{translate(locale, "adminModeration.ownDecision")}</Alert>
                ) : null}
                <form
                  className={rowForm}
                  onSubmit={(formEvent) => {
                    formEvent.preventDefault();
                    const submitter = (formEvent.nativeEvent as SubmitEvent)
                      .submitter as HTMLButtonElement | null;
                    const reason = reasonFrom(formEvent);
                    void run(async ({ api, token }) => {
                      setLists({
                        appeals: await api.decideAppeal(token, item.id, {
                          decision: submitter?.value === "reverse" ? "reverse" : "uphold",
                          reason,
                        }),
                      });
                    });
                  }}
                >
                  <Field>
                    <Label htmlFor={`appeal-reason-${item.id}`}>
                      {translate(locale, "cases.reason")}
                    </Label>
                    <Textarea
                      id={`appeal-reason-${item.id}`}
                      maxLength={500}
                      name="reason"
                      required
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" value="reverse">
                      {translate(locale, "adminModeration.reverse")}
                    </Button>
                    <Button type="submit" value="uphold" variant="outline">
                      {translate(locale, "adminModeration.uphold")}
                    </Button>
                  </div>
                </form>
              </article>
            ))}
          </CardContent>
        </section>
      </Card>

      <Card aria-labelledby="admin-cases-heading" asChild>
        <section>
          <CardHeader>
            <CardTitle id="admin-cases-heading">
              {translate(locale, "adminModeration.cases")}
            </CardTitle>
          </CardHeader>
          <CardContent className="gap-0 divide-y">
            {cases.length === 0 ? (
              <p className="text-muted-foreground">{translate(locale, "cases.empty")}</p>
            ) : null}
            {cases.map((item) => (
              <article className={row} key={item.id}>
                <h3 className="text-lg font-bold">
                  {item.eventTitle} · {translate(locale, `cases.subject.${item.subjectType}`)}
                  {item.quarantined ? ` · ${translate(locale, "cases.quarantined")}` : ""}
                </h3>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {item.reports.map((report) => (
                    <li className="grid gap-2 rounded-xl bg-muted p-4" key={report.id}>
                      <span className="text-sm">
                        <strong>{translate(locale, `report.reason.${report.reason}`)}</strong> ·{" "}
                        {formatDateTime(locale, report.createdAt, "Europe/Stockholm")}
                      </span>
                      <p className="break-words">{report.details}</p>
                      {report.hasContact ? (
                        contacts[report.id] ? (
                          <p className="font-semibold break-all">{contacts[report.id]}</p>
                        ) : (
                          <form
                            className="flex flex-wrap items-center gap-2"
                            onSubmit={(formEvent) => {
                              formEvent.preventDefault();
                              const reason = reasonFrom(formEvent);
                              void run(async ({ api, token }) => {
                                const result = await api.readReportContact(
                                  token,
                                  report.id,
                                  reason,
                                );
                                setContacts((current) => ({
                                  ...current,
                                  [report.id]: result.contact ?? "",
                                }));
                              });
                            }}
                          >
                            <label className="sr-only" htmlFor={`contact-reason-${report.id}`}>
                              {translate(locale, "adminModeration.contactReason")}
                            </label>
                            <Input
                              className="min-w-0 flex-1 basis-48"
                              id={`contact-reason-${report.id}`}
                              name="reason"
                              placeholder={translate(locale, "adminModeration.contactReason")}
                              required
                            />
                            <Button type="submit" variant="outline">
                              {translate(locale, "adminModeration.showContact")}
                            </Button>
                          </form>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </CardContent>
        </section>
      </Card>

      <Card aria-labelledby="accounts-heading" asChild>
        <section>
          <CardHeader>
            <CardTitle id="accounts-heading">
              {translate(locale, "adminModeration.accounts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="gap-6">
            <form
              className={rowForm}
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                const form = new FormData(formEvent.currentTarget);
                void run(async ({ api, token }) => {
                  setAccount(
                    await api.findAccount(token, {
                      email: String(form.get("email") ?? "").trim(),
                      reason: String(form.get("reason") ?? "").trim(),
                    }),
                  );
                });
              }}
            >
              <Field>
                <Label htmlFor="account-email">{translate(locale, "adminModeration.email")}</Label>
                <Input id="account-email" name="email" required type="email" />
              </Field>
              <Field>
                <Label htmlFor="account-reason">
                  {translate(locale, "adminModeration.lookupReason")}
                </Label>
                <Input id="account-reason" name="reason" required />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="outline">
                  {translate(locale, "admin.lookup")}
                </Button>
              </div>
            </form>
            {account ? (
              <article className="grid gap-3 border-t pt-5">
                <h3 className="text-lg font-bold break-words">
                  {account.displayName ?? account.accountId}
                </h3>
                {account.restriction ? (
                  <p>
                    {translate(locale, "adminModeration.restricted")}: {account.restriction.reason}
                    {account.restriction.pendingLift
                      ? ` · ${translate(locale, "adminModeration.pendingLift")}`
                      : ""}
                  </p>
                ) : (
                  <p>{translate(locale, "adminModeration.notRestricted")}</p>
                )}
                <form
                  className={rowForm}
                  onSubmit={(formEvent) => {
                    formEvent.preventDefault();
                    const reason = reasonFrom(formEvent);
                    const restriction = account.restriction;
                    void run(async ({ api, token }) => {
                      if (restriction) {
                        const result = await api.liftRestriction(token, restriction.id, reason);
                        setAccount({
                          ...account,
                          restriction: result.pendingApproval
                            ? { ...restriction, pendingLift: true }
                            : null,
                        });
                        setLists({ approvals: await api.listAdminApprovals(token) });
                      } else {
                        setAccount(await api.restrictAccount(token, account.accountId, reason));
                      }
                    });
                  }}
                >
                  <Field>
                    <Label htmlFor="restriction-reason">{translate(locale, "cases.reason")}</Label>
                    <Textarea id="restriction-reason" maxLength={500} name="reason" required />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" variant={account.restriction ? "outline" : "destructive"}>
                      {translate(
                        locale,
                        account.restriction ? "adminModeration.lift" : "adminModeration.restrict",
                      )}
                    </Button>
                  </div>
                </form>
              </article>
            ) : null}
          </CardContent>
        </section>
      </Card>

      <Card aria-labelledby="approvals-heading" asChild>
        <section>
          <CardHeader>
            <CardTitle id="approvals-heading">
              {translate(locale, "adminModeration.approvals")}
            </CardTitle>
          </CardHeader>
          <CardContent className="gap-0 divide-y">
            {approvals.length === 0 ? (
              <p className="text-muted-foreground">
                {translate(locale, "adminModeration.noApprovals")}
              </p>
            ) : null}
            {approvals.map((item) => (
              <article className={row} key={item.id}>
                <p>
                  {translate(locale, "adminModeration.liftRequest")}: {item.reason}
                </p>
                {item.ownRequest ? (
                  <p className="text-sm text-muted-foreground">
                    {translate(locale, "adminModeration.ownRequest")}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    {([true, false] as const).map((approve) => (
                      <Button
                        key={String(approve)}
                        onClick={() =>
                          void run(async ({ api, token }) => {
                            setLists({
                              approvals: await api.decideAdminApproval(token, item.id, approve),
                            });
                          })
                        }
                        type="button"
                        variant={approve ? "default" : "outline"}
                      >
                        {translate(
                          locale,
                          approve ? "adminModeration.approve" : "adminModeration.reject",
                        )}
                      </Button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </CardContent>
        </section>
      </Card>
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {shownStatus}
      </p>
    </>
  );
}
