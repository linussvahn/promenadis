import { PromenadisApiError } from "@promenadis/api-client";
import type { MfaStatus, TotpEnrollment } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { ShieldCheckIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function TwoStep({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    try {
      setMfa(await api.getMfaStatus(token));
    } catch {
      setStatus(translate(locale, "mfa.error"));
    }
  }, [accessToken, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const failure = (error: unknown) =>
    translate(
      locale,
      error instanceof PromenadisApiError && error.code === "recent_auth_required"
        ? "mfa.recentAuth"
        : "mfa.error",
    );

  const start = async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setStatus("");
    try {
      setEnrollment(await api.enrollTotp(token));
    } catch (error) {
      setStatus(failure(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("totpSetupCode") ?? "").trim();
    const token = await accessToken();
    const auth = getBrowserAuthClient(token);
    if (!auth || !enrollment) return;
    setBusy(true);
    setStatus("");
    const { error } = await auth.auth.verifyTotp({ code, factorId: enrollment.factorId });
    setBusy(false);
    if (error) {
      setStatus(translate(locale, "mfa.failed"));
      return;
    }
    setEnrollment(null);
    setStatus(translate(locale, "mfa.enabled"));
    await load();
  };

  const remove = async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setStatus("");
    try {
      setMfa(await api.removeTotp(token));
      setStatus(translate(locale, "mfa.removed"));
    } catch (error) {
      setStatus(failure(error));
    } finally {
      setBusy(false);
    }
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
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
