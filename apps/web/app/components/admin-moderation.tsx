import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type {
  AdminAccount,
  AdminApproval,
  AdminCase,
  AppealQueueItem,
} from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Call = () => Promise<{ api: ApiClient; token: string } | null>;

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
  const [appeals, setAppeals] = useState<AppealQueueItem[]>([]);
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [approvals, setApprovals] = useState<AdminApproval[]>([]);
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const client = await call();
    if (!client) return;
    try {
      const [nextAppeals, nextCases, nextApprovals] = await Promise.all([
        client.api.listAppeals(client.token),
        client.api.listAdminCases(client.token),
        client.api.listAdminApprovals(client.token),
      ]);
      setAppeals(nextAppeals);
      setCases(nextCases);
      setApprovals(nextApprovals);
    } catch {
      setStatus(translate(locale, "admin.error"));
    }
  }, [call, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: (client: NonNullable<Awaited<ReturnType<Call>>>) => Promise<void>) => {
    const client = await call();
    if (!client) return;
    setStatus("");
    try {
      await action(client);
      setStatus(translate(locale, "adminModeration.saved"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(translate(locale, errorKeys[code as keyof typeof errorKeys] ?? "admin.error"));
    }
  };

  const reasonFrom = (formEvent: FormEvent<HTMLFormElement>) =>
    String(new FormData(formEvent.currentTarget).get("reason") ?? "").trim();

  return (
    <>
      <section aria-labelledby="appeals-heading" className="panel">
        <h2 id="appeals-heading">{translate(locale, "adminModeration.appeals")}</h2>
        {appeals.length === 0 ? <p>{translate(locale, "adminModeration.noAppeals")}</p> : null}
        {appeals.map((item) => (
          <article className="review-item" key={item.id}>
            <h3>
              {item.eventTitle}: {item.action}
            </h3>
            <p className="field-help">{item.actionReason}</p>
            <blockquote>{item.statement}</blockquote>
            {item.ownDecision ? (
              <p className="notice">{translate(locale, "adminModeration.ownDecision")}</p>
            ) : null}
            <form
              className="details-form"
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                const submitter = (formEvent.nativeEvent as SubmitEvent)
                  .submitter as HTMLButtonElement | null;
                const reason = reasonFrom(formEvent);
                void run(async ({ api, token }) => {
                  setAppeals(
                    await api.decideAppeal(token, item.id, {
                      decision: submitter?.value === "reverse" ? "reverse" : "uphold",
                      reason,
                    }),
                  );
                });
              }}
            >
              <label htmlFor={`appeal-reason-${item.id}`}>
                {translate(locale, "cases.reason")}
              </label>
              <textarea id={`appeal-reason-${item.id}`} maxLength={500} name="reason" required />
              <div className="form-actions">
                <button className="primary-button" type="submit" value="reverse">
                  {translate(locale, "adminModeration.reverse")}
                </button>
                <button className="secondary-button" type="submit" value="uphold">
                  {translate(locale, "adminModeration.uphold")}
                </button>
              </div>
            </form>
          </article>
        ))}
      </section>

      <section aria-labelledby="admin-cases-heading" className="panel">
        <h2 id="admin-cases-heading">{translate(locale, "adminModeration.cases")}</h2>
        {cases.length === 0 ? <p>{translate(locale, "cases.empty")}</p> : null}
        {cases.map((item) => (
          <article className="review-item" key={item.id}>
            <h3>
              {item.eventTitle} · {translate(locale, `cases.subject.${item.subjectType}`)}
              {item.quarantined ? ` · ${translate(locale, "cases.quarantined")}` : ""}
            </h3>
            <ul>
              {item.reports.map((report) => (
                <li key={report.id}>
                  <strong>{translate(locale, `report.reason.${report.reason}`)}</strong> ·{" "}
                  {formatDateTime(locale, report.createdAt, "Europe/Stockholm")}
                  <p>{report.details}</p>
                  {report.hasContact ? (
                    contacts[report.id] ? (
                      <p>{contacts[report.id]}</p>
                    ) : (
                      <form
                        className="inline-control"
                        onSubmit={(formEvent) => {
                          formEvent.preventDefault();
                          const reason = reasonFrom(formEvent);
                          void run(async ({ api, token }) => {
                            const result = await api.readReportContact(token, report.id, reason);
                            setContacts((current) => ({
                              ...current,
                              [report.id]: result.contact ?? "",
                            }));
                          });
                        }}
                      >
                        <label className="visually-hidden" htmlFor={`contact-reason-${report.id}`}>
                          {translate(locale, "adminModeration.contactReason")}
                        </label>
                        <input
                          id={`contact-reason-${report.id}`}
                          name="reason"
                          placeholder={translate(locale, "adminModeration.contactReason")}
                          required
                        />
                        <button className="secondary-button" type="submit">
                          {translate(locale, "adminModeration.showContact")}
                        </button>
                      </form>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section aria-labelledby="accounts-heading" className="panel">
        <h2 id="accounts-heading">{translate(locale, "adminModeration.accounts")}</h2>
        <form
          className="details-form"
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
          <label htmlFor="account-email">{translate(locale, "adminModeration.email")}</label>
          <input id="account-email" name="email" required type="email" />
          <label htmlFor="account-reason">
            {translate(locale, "adminModeration.lookupReason")}
          </label>
          <input id="account-reason" name="reason" required />
          <button className="secondary-button" type="submit">
            {translate(locale, "admin.lookup")}
          </button>
        </form>
        {account ? (
          <article className="review-item">
            <h3>{account.displayName ?? account.accountId}</h3>
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
              className="details-form"
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
                    setApprovals(await api.listAdminApprovals(token));
                  } else {
                    setAccount(await api.restrictAccount(token, account.accountId, reason));
                  }
                });
              }}
            >
              <label htmlFor="restriction-reason">{translate(locale, "cases.reason")}</label>
              <textarea id="restriction-reason" maxLength={500} name="reason" required />
              <button
                className={account.restriction ? "secondary-button" : "danger-button"}
                type="submit"
              >
                {translate(
                  locale,
                  account.restriction ? "adminModeration.lift" : "adminModeration.restrict",
                )}
              </button>
            </form>
          </article>
        ) : null}
      </section>

      <section aria-labelledby="approvals-heading" className="panel">
        <h2 id="approvals-heading">{translate(locale, "adminModeration.approvals")}</h2>
        {approvals.length === 0 ? <p>{translate(locale, "adminModeration.noApprovals")}</p> : null}
        {approvals.map((item) => (
          <article className="review-item" key={item.id}>
            <p>
              {translate(locale, "adminModeration.liftRequest")}: {item.reason}
            </p>
            {item.ownRequest ? (
              <p className="field-help">{translate(locale, "adminModeration.ownRequest")}</p>
            ) : (
              <div className="form-actions">
                {([true, false] as const).map((approve) => (
                  <button
                    className={approve ? "primary-button" : "secondary-button"}
                    key={String(approve)}
                    onClick={() =>
                      void run(async ({ api, token }) => {
                        setApprovals(await api.decideAdminApproval(token, item.id, approve));
                      })
                    }
                    type="button"
                  >
                    {translate(
                      locale,
                      approve ? "adminModeration.approve" : "adminModeration.reject",
                    )}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </>
  );
}
