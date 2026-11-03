import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountDeletionStatus } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Client = {
  readonly api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
  readonly token: string;
};

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
  const queryClient = useQueryClient();
  const deletionKey = accountKey(useExpectedAccountId(), "account-deletion");
  const [status, setStatus] = useState("");

  const call = async (): Promise<Client | null> => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  };

  // Account deletion is security-sensitive: no automatic retries or
  // background refetches, so the request sequence stays exactly as before.
  const deletionQuery = useQuery({
    queryKey: deletionKey,
    queryFn: async (): Promise<AccountDeletionStatus | null> => {
      const client = await call();
      return client ? client.api.getAccountDeletion(client.token) : null;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const deletion = deletionQuery.data ?? null;

  const requestMutation = useMutation({
    mutationFn: ({ api, token, confirmationEmail }: Client & { confirmationEmail: string }) =>
      api.requestAccountDeletion(token, { confirmationEmail }),
    // Every session was revoked; signing in again only reaches cancellation.
    onSuccess: () => navigate({ replace: true, to: "/sign-in" }),
    onError: async (error) => {
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
      await deletionQuery.refetch();
    },
    retry: false,
  });

  const cancelMutation = useMutation({
    mutationFn: ({ api, token }: Client) => api.cancelAccountDeletion(token),
    onSuccess: async (next) => {
      queryClient.setQueryData(deletionKey, next);
      setStatus(translate(locale, "deletion.cancelled"));
      await onCancelled();
    },
    onError: () => setStatus(translate(locale, "deletion.error")),
    retry: false,
  });

  const busy = requestMutation.isPending || cancelMutation.isPending;
  const shownStatus = status || (deletionQuery.isError ? translate(locale, "deletion.error") : "");

  const request = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirmationEmail = String(new FormData(event.currentTarget).get("confirmationEmail"));
    const client = await call();
    if (!client) return;
    setStatus("");
    requestMutation.mutate({ ...client, confirmationEmail });
  };

  const cancel = async () => {
    const client = await call();
    if (!client) return;
    setStatus("");
    cancelMutation.mutate(client);
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
                          <Link
                            className="font-semibold"
                            params={{ eventId: blocker.id }}
                            to="/events/$eventId"
                          >
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
            {shownStatus}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
