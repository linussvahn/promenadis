import { translate } from "@promenadis/i18n";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { getBrowserAuthClient, hasLocalBackendConfiguration } from "../lib/supabase";
import { PageHeader } from "./page-header";

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
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {translate(locale, "home.skip")}
      </a>
      <PageHeader locale={locale} onLocaleChange={setLocale} />
      <main className="account-page" id="main" tabIndex={-1}>
        <a className="back-link" href="/">
          ← {translate(locale, "common.backHome")}
        </a>
        <div className="account-heading">
          <p className="eyebrow">Promenadis</p>
          <h1>{translate(locale, "auth.title")}</h1>
          <p className="lede">{translate(locale, "auth.intro")}</p>
        </div>

        {!configured ? (
          <p className="notice notice-error" role="alert">
            {translate(locale, "auth.configMissing")}
          </p>
        ) : mfaStep ? (
          <form className="panel form-panel" onSubmit={verifyTotp}>
            <h2>{translate(locale, "mfa.stepTitle")}</h2>
            <p>{translate(locale, "mfa.stepHelp")}</p>
            <label htmlFor="totp">{translate(locale, "mfa.code")}</label>
            <input
              autoComplete="one-time-code"
              id="totp"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="totp"
              pattern="[0-9]{6}"
              required
            />
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? translate(locale, "auth.working") : translate(locale, "mfa.verify")}
            </button>
          </form>
        ) : (
          <div className="form-stack">
            <form className="panel form-panel" onSubmit={sendCode}>
              <label htmlFor="email">{translate(locale, "auth.email")}</label>
              <input autoComplete="email" id="email" name="email" required type="email" />
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? translate(locale, "auth.working") : translate(locale, "auth.send")}
              </button>
              <a href="/recover-account">{translate(locale, "accountRecovery.link")}</a>
            </form>

            {sent ? (
              <form className="panel form-panel" onSubmit={verifyCode}>
                <label htmlFor="otp">{translate(locale, "auth.otp")}</label>
                <input
                  autoComplete="one-time-code"
                  id="otp"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="otp"
                  pattern="[0-9]{6}"
                  required
                />
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? translate(locale, "auth.working") : translate(locale, "auth.verify")}
                </button>
                <a href="http://127.0.0.1:54324" rel="noreferrer">
                  {translate(locale, "auth.mailpit")}
                </a>
              </form>
            ) : null}
          </div>
        )}

        <p aria-live="polite" className="form-status">
          {status}
        </p>
      </main>
    </div>
  );
}
