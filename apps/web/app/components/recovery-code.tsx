import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountRecoveryStatus } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { FieldDescription } from "./ui/field";

type Client = {
  readonly api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
  readonly token: string;
};

export function RecoveryCode({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const recoveryKey = accountKey(useExpectedAccountId(), "recovery");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const call = async (): Promise<Client | null> => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  };

  // Recovery is security-sensitive: no automatic retries or background
  // refetches, so the request sequence stays exactly as before.
  const recoveryQuery = useQuery({
    queryKey: recoveryKey,
    queryFn: async (): Promise<AccountRecoveryStatus | null> => {
      const client = await call();
      return client ? client.api.getAccountRecoveryStatus(client.token) : null;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const recovery = recoveryQuery.data ?? null;

  const enrollMutation = useMutation({
    mutationFn: ({ api, token, expectedVersion }: Client & { expectedVersion: number }) =>
      api.enrollRecoveryCode(token, { expectedVersion }),
    onSuccess: ({ code, ...next }) => {
      // The code is shown once from component state and never kept in the cache.
      queryClient.setQueryData<AccountRecoveryStatus | null>(recoveryKey, next);
      setGeneratedCode(code);
      setStatus(translate(locale, "recovery.created"));
    },
    onError: async (error) => {
      if (error instanceof PromenadisApiError && error.code === "recent_auth_required") {
        setStatus(translate(locale, "recovery.recentAuth"));
      } else if (error instanceof PromenadisApiError && error.code === "version_conflict") {
        await recoveryQuery.refetch();
        setStatus(translate(locale, "recovery.versionConflict"));
      } else {
        setStatus(translate(locale, "recovery.error"));
      }
    },
    retry: false,
  });

  const cancelMutation = useMutation({
    mutationFn: ({ api, token, claimId }: Client & { claimId: string }) =>
      api.cancelAccountRecovery(token, claimId),
    onSuccess: (next) => {
      queryClient.setQueryData(recoveryKey, next);
      setStatus(translate(locale, "accountRecovery.cancelled"));
    },
    onError: (error) =>
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "recent_auth_required"
            ? "recovery.recentAuth"
            : "recovery.error",
        ),
      ),
    retry: false,
  });

  const busy = enrollMutation.isPending || cancelMutation.isPending;
  const shownStatus = status || (recoveryQuery.isError ? translate(locale, "recovery.error") : "");

  const enroll = async () => {
    if (!recovery) return;
    const client = await call();
    if (!client) return;
    setGeneratedCode(null);
    setStatus("");
    enrollMutation.mutate({ ...client, expectedVersion: recovery.version });
  };

  const cancelRecovery = async () => {
    const client = await call();
    if (!client || !recovery?.pendingClaim) return;
    setStatus("");
    cancelMutation.mutate({ ...client, claimId: recovery.pendingClaim.id });
  };

  return (
    <Card asChild>
      <section aria-labelledby="recovery-heading">
        <CardHeader>
          <CardTitle id="recovery-heading">{translate(locale, "recovery.title")}</CardTitle>
          <CardDescription>{translate(locale, "recovery.intro")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!recovery ? (
            <p aria-live="polite">{shownStatus || translate(locale, "common.loading")}</p>
          ) : (
            <>
              {recovery.pendingClaim ? (
                <Alert variant="warning">
                  <AlertDescription>
                    <h3 className="text-base font-bold">
                      {translate(locale, "accountRecovery.pendingTitle")}
                    </h3>
                    <p className="break-all">{recovery.pendingClaim.newEmailMasked}</p>
                    <p>
                      {translate(
                        locale,
                        recovery.pendingClaim.emailVerified
                          ? "accountRecovery.verified"
                          : "accountRecovery.unverified",
                      )}
                    </p>
                    <Button
                      disabled={busy}
                      onClick={() => void cancelRecovery()}
                      type="button"
                      variant="outline"
                    >
                      {translate(locale, "accountRecovery.cancel")}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              <Alert variant={recovery.active ? "success" : "default"}>
                <AlertDescription>
                  {translate(locale, recovery.active ? "recovery.active" : "recovery.missing")}
                </AlertDescription>
              </Alert>
              {recovery.issuedAt ? (
                <FieldDescription>
                  {translate(locale, "recovery.issued")}{" "}
                  {formatDateTime(locale, recovery.issuedAt, "Europe/Stockholm")}
                </FieldDescription>
              ) : null}
              {generatedCode ? (
                <div className="grid gap-3 rounded-xl border bg-muted/60 p-4" role="status">
                  <strong>{translate(locale, "recovery.saveNow")}</strong>
                  <code className="w-fit max-w-full rounded-lg border border-input bg-card px-3.5 py-2.5 font-mono text-[clamp(1rem,4vw,1.25rem)] tracking-[0.08em] [overflow-wrap:anywhere]">
                    {generatedCode}
                  </code>
                  <p className="text-sm text-muted-foreground">
                    {translate(locale, "recovery.shownOnce")}
                  </p>
                </div>
              ) : null}
              {recovery.active ? (
                <details className="group border-t pt-2">
                  <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 font-semibold text-link [&::-webkit-details-marker]:hidden">
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-4 transition-transform group-open:rotate-90"
                    />
                    {translate(locale, "recovery.rotateTitle")}
                  </summary>
                  <div className="grid justify-items-start gap-3 pt-1">
                    <p className="text-sm text-muted-foreground">
                      {translate(locale, "recovery.rotateHelp")}
                    </p>
                    <Button
                      disabled={busy}
                      onClick={() => void enroll()}
                      type="button"
                      variant="outline"
                    >
                      {busy
                        ? translate(locale, "common.saving")
                        : translate(locale, "recovery.rotate")}
                    </Button>
                  </div>
                </details>
              ) : (
                <div>
                  <Button disabled={busy} onClick={() => void enroll()} type="button">
                    {busy
                      ? translate(locale, "common.saving")
                      : translate(locale, "recovery.create")}
                  </Button>
                </div>
              )}
            </>
          )}
          {recovery ? (
            <p aria-live="polite" className="min-h-6 text-sm font-semibold">
              {shownStatus}
            </p>
          ) : null}
        </CardContent>
      </section>
    </Card>
  );
}
