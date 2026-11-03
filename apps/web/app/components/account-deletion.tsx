import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountDeletionStatus } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function AccountDeletion({
  accessToken,
  locale,
  onCancelled,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
  readonly onCancelled: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [deletion, setDeletion] = useState<AccountDeletionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    try {
      setDeletion(await api.getAccountDeletion(token));
    } catch {
      setStatus(translate(locale, "deletion.error"));
    }
  }, [accessToken, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirmationEmail = String(new FormData(event.currentTarget).get("confirmationEmail"));
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setStatus("");
    try {
      await api.requestAccountDeletion(token, { confirmationEmail });
      // Every session was revoked; signing in again only reaches cancellation.
      await navigate("/sign-in", { replace: true });
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "recent_auth_required"
            ? "deletion.recentAuth"
            : code === "confirmation_mismatch"
              ? "deletion.mismatch"
              : code === "deletion_blocked"
                ? "deletion.blocked"
                : "deletion.error",
        ),
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setStatus("");
    try {
      setDeletion(await api.cancelAccountDeletion(token));
      setStatus(translate(locale, "deletion.cancelled"));
      await onCancelled();
    } catch {
      setStatus(translate(locale, "deletion.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card asChild className="border-destructive/40">
      <section aria-labelledby="deletion-heading">
        <CardHeader>
          <CardTitle className="text-destructive-foreground" id="deletion-heading">
            {translate(locale, "deletion.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!deletion ? (
            <p aria-live="polite">{translate(locale, "common.loading")}</p>
          ) : deletion.pending ? (
            <>
              <Alert variant="warning">
                <AlertDescription>
                  <p className="font-semibold">
                    {translate(locale, "deletion.pending")}{" "}
                    {deletion.eraseAfter
                      ? formatDateTime(locale, deletion.eraseAfter, "Europe/Stockholm")
                      : null}
                  </p>
                  <p>{translate(locale, "deletion.pendingHelp")}</p>
                </AlertDescription>
              </Alert>
              <div>
                <Button disabled={busy} onClick={() => void cancel()} type="button">
                  {translate(locale, "deletion.cancel")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="max-w-prose text-muted-foreground">
                {translate(locale, "deletion.help")}
              </p>
              {deletion.blockers.length > 0 ? (
                <div className="grid gap-2 rounded-xl bg-muted/60 p-4">
                  <p className="font-semibold">{translate(locale, "deletion.blockersIntro")}</p>
                  <ul className="m-0 grid list-disc gap-1 pl-5">
                    {deletion.blockers.map((blocker) => (
                      <li key={`${blocker.kind}-${blocker.id}`}>
                        {blocker.kind === "owned_event" ? (
                          <Link className="font-semibold" to={`/events/${blocker.id}`}>
                            {blocker.title}
                          </Link>
                        ) : (
                          blocker.title
                        )}{" "}
                        — {translate(locale, `deletion.blocker.${blocker.kind}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <form
                  className="grid max-w-md gap-4 rounded-xl border border-destructive/30 bg-destructive-soft/50 p-4"
                  onSubmit={request}
                >
                  <Field>
                    <Label htmlFor="deletion-confirmation">
                      {translate(locale, "deletion.confirmLabel")}
                    </Label>
                    <Input
                      autoComplete="off"
                      id="deletion-confirmation"
                      name="confirmationEmail"
                      required
                      type="email"
                    />
                  </Field>
                  <div>
                    <Button disabled={busy} type="submit" variant="destructive">
                      {translate(locale, "deletion.request")}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
