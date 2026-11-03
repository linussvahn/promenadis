import { PromenadisApiError } from "@promenadis/api-client";
import type { MfaStatus, TotpEnrollment } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheckIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Client = {
  readonly api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
  readonly token: string;
};
type AuthClient = NonNullable<ReturnType<typeof getBrowserAuthClient>>;

export function TwoStep({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const mfaKey = accountKey(useExpectedAccountId(), "mfa");
  // The TOTP secret lives only in component state, never in the query cache.
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [status, setStatus] = useState("");

  const call = async (): Promise<Client | null> => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  };

  // TOTP is security-sensitive: no automatic retries or background
  // refetches, so the request sequence stays exactly as before.
  const mfaQuery = useQuery({
    queryKey: mfaKey,
    queryFn: async (): Promise<MfaStatus | null> => {
      const client = await call();
      return client ? client.api.getMfaStatus(client.token) : null;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  const mfa = mfaQuery.data ?? null;

  const failure = (error: unknown) =>
    translate(
      locale,
      error instanceof PromenadisApiError && error.code === "recent_auth_required"
        ? "mfa.recentAuth"
        : "mfa.error",
    );

  const startMutation = useMutation({
    mutationFn: ({ api, token }: Client) => api.enrollTotp(token),
    onSuccess: setEnrollment,
    onError: (error) => setStatus(failure(error)),
    retry: false,
  });

  const confirmMutation = useMutation({
    mutationFn: ({ auth, code, factorId }: { auth: AuthClient; code: string; factorId: string }) =>
      auth.auth.verifyTotp({ code, factorId }),
    onSuccess: ({ error }) => {
      if (error) {
        setStatus(translate(locale, "mfa.failed"));
        return;
      }
      setEnrollment(null);
      setStatus(translate(locale, "mfa.enabled"));
      void mfaQuery.refetch();
    },
    onError: () => setStatus(translate(locale, "mfa.failed")),
    retry: false,
  });

  const removeMutation = useMutation({
    mutationFn: ({ api, token }: Client) => api.removeTotp(token),
    onSuccess: (next) => {
      queryClient.setQueryData(mfaKey, next);
      setStatus(translate(locale, "mfa.removed"));
    },
    onError: (error) => setStatus(failure(error)),
    retry: false,
  });

  const busy = startMutation.isPending || confirmMutation.isPending || removeMutation.isPending;
  const shownStatus = status || (mfaQuery.isError ? translate(locale, "mfa.error") : "");

  const start = async () => {
    const client = await call();
    if (!client) return;
    setStatus("");
    startMutation.mutate(client);
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("totpSetupCode") ?? "").trim();
    const token = await accessToken();
    const auth = getBrowserAuthClient(token);
    if (!auth || !enrollment) return;
    setStatus("");
    confirmMutation.mutate({ auth, code, factorId: enrollment.factorId });
  };

  const remove = async () => {
    const client = await call();
    if (!client) return;
    setStatus("");
    removeMutation.mutate(client);
  };

  return (
    <Card asChild>
      <section aria-labelledby="two-step-heading">
        <CardHeader>
          <CardTitle id="two-step-heading">{translate(locale, "mfa.title")}</CardTitle>
          <CardDescription>{translate(locale, "mfa.intro")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!mfa ? (
            <p aria-live="polite">{translate(locale, "common.loading")}</p>
          ) : mfa.totpEnabled ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-success-soft p-4">
              <p className="flex items-center gap-2 font-semibold text-success-foreground">
                <ShieldCheckIcon aria-hidden="true" className="size-5" />
                {translate(locale, "mfa.on")}
              </p>
              <Button disabled={busy} onClick={() => void remove()} type="button" variant="outline">
                {translate(locale, "mfa.remove")}
              </Button>
            </div>
          ) : enrollment ? (
            <form className="grid max-w-md gap-4" onSubmit={confirm}>
              <p>{translate(locale, "mfa.scan")}</p>
              <img
                alt={translate(locale, "mfa.qrAlt")}
                className="rounded-xl border bg-white p-2"
                height={180}
                src={enrollment.qrCode}
                width={180}
              />
              <p className="text-sm">
                {translate(locale, "mfa.secret")}{" "}
                <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono [overflow-wrap:anywhere]">
                  {enrollment.secret}
                </code>
              </p>
              <Field>
                <Label htmlFor="totp-setup-code">{translate(locale, "mfa.code")}</Label>
                <Input
                  autoComplete="one-time-code"
                  className="max-w-48 font-mono tracking-[0.2em]"
                  id="totp-setup-code"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="totpSetupCode"
                  pattern="[0-9]{6}"
                  required
                />
              </Field>
              <div>
                <Button disabled={busy} type="submit">
                  {translate(locale, "mfa.confirm")}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button disabled={busy} onClick={() => void start()} type="button">
                {translate(locale, "mfa.enable")}
              </Button>
            </div>
          )}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {shownStatus}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
