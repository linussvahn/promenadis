import { translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { getBrowserAuthClient, hasLocalBackendConfiguration } from "../lib/supabase";
import { backLink, PageHeading, PageMain, siteShell, skipLink } from "./page";
import { PageHeader } from "./page-header";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function SignIn() {
  const navigate = useNavigate();
  const { locale, setLocale } = useStoredLocale();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const configured = hasLocalBackendConfiguration();
  const [searchParams] = useSearchParams();
  const mfaStep = searchParams.get("step") === "mfa";

  const verifyTotp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("totp") ?? "").trim();
    const supabase = getBrowserAuthClient();
    if (!supabase) return;
    setBusy(true);
    setStatus("");
    const { error } = await supabase.auth.verifyTotp({ code });
    setBusy(false);
    if (error) {
      setStatus(translate(locale, "mfa.failed"));
      return;
    }
    await navigate("/dashboard", { replace: true });
  };

  const sendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supabase = getBrowserAuthClient();
    if (!supabase) return;
    const submittedEmail = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!submittedEmail) {
      setStatus(translate(locale, "auth.emailRequired"));
      return;
    }

    setBusy(true);
    setStatus("");
    const { error } = await supabase.auth.signInWithOtp({
      email: submittedEmail,
      options: {
        emailRedirectTo: new URL("/auth/callback", window.location.origin).toString(),
        shouldCreateUser: true,
      },
    });
    setBusy(false);
    if (error) {
      setStatus(
        translate(
          locale,
          error.status === 429 || error.code === "over_email_send_rate_limit"
            ? "auth.rateLimited"
            : "auth.error",
        ),
      );
      return;
    }
    setEmail(submittedEmail);
    setSent(true);
    setStatus(translate(locale, "auth.sent"));
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supabase = getBrowserAuthClient();
    if (!supabase) return;
    const submittedCode = String(new FormData(event.currentTarget).get("otp") ?? "").trim();

    setBusy(true);
    setStatus("");
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: submittedCode,
      type: "email",
    });
    setBusy(false);
    if (error) {
      setStatus(translate(locale, "auth.error"));
      return;
    }
    await navigate("/dashboard");
  };

  return (
    <div className={siteShell}>
      <a className={skipLink} href="#main">
        {translate(locale, "home.skip")}
      </a>
      <PageHeader locale={locale} onLocaleChange={setLocale} />
      <PageMain className="mx-auto w-full max-w-md" width="flow">
        <a className={backLink} href="/">
          ← {translate(locale, "common.backHome")}
        </a>
        <PageHeading
          description={translate(locale, "auth.intro")}
          eyebrow="Promenadis"
          title={translate(locale, "auth.title")}
        />

        {!configured ? (
          <Alert role="alert" variant="destructive">
            {translate(locale, "auth.configMissing")}
          </Alert>
        ) : mfaStep ? (
          <Card asChild>
            <form onSubmit={verifyTotp}>
              <CardHeader>
                <CardTitle>{translate(locale, "mfa.stepTitle")}</CardTitle>
                <CardDescription>{translate(locale, "mfa.stepHelp")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Field>
                  <Label htmlFor="totp">{translate(locale, "mfa.code")}</Label>
                  <Input
                    autoComplete="one-time-code"
                    id="totp"
                    inputMode="numeric"
                    maxLength={6}
                    minLength={6}
                    name="totp"
                    pattern="[0-9]{6}"
                    required
                  />
                </Field>
                <Button className="w-full" disabled={busy} type="submit">
                  {busy ? translate(locale, "auth.working") : translate(locale, "mfa.verify")}
                </Button>
              </CardContent>
            </form>
          </Card>
        ) : (
          <div className="grid gap-5">
            <Card asChild>
              <form onSubmit={sendCode}>
                <CardContent>
                  <Field>
                    <Label htmlFor="email">{translate(locale, "auth.email")}</Label>
                    <Input autoComplete="email" id="email" name="email" required type="email" />
                  </Field>
                  <Button className="w-full" disabled={busy} type="submit">
                    {busy ? translate(locale, "auth.working") : translate(locale, "auth.send")}
                  </Button>
                  <a className="justify-self-center font-semibold" href="/recover-account">
                    {translate(locale, "accountRecovery.link")}
                  </a>
                </CardContent>
              </form>
            </Card>

            {sent ? (
              <Card asChild>
                <form onSubmit={verifyCode}>
                  <CardContent>
                    <Field>
                      <Label htmlFor="otp">{translate(locale, "auth.otp")}</Label>
                      <Input
                        autoComplete="one-time-code"
                        id="otp"
                        inputMode="numeric"
                        maxLength={6}
                        minLength={6}
                        name="otp"
                        pattern="[0-9]{6}"
                        required
                      />
                    </Field>
                    <Button className="w-full" disabled={busy} type="submit">
                      {busy ? translate(locale, "auth.working") : translate(locale, "auth.verify")}
                    </Button>
                    <a
                      className="justify-self-center font-semibold"
                      href="http://127.0.0.1:54324"
                      rel="noreferrer"
                    >
                      {translate(locale, "auth.mailpit")}
                    </a>
                  </CardContent>
                </form>
              </Card>
            ) : null}
          </div>
        )}

        <p aria-live="polite" className="min-h-6 text-sm font-semibold">
          {status}
        </p>
      </PageMain>
    </div>
  );
}
