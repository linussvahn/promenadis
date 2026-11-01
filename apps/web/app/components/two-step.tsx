import { PromenadisApiError } from "@promenadis/api-client";
import type { MfaStatus, TotpEnrollment } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";

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
    <section aria-labelledby="two-step-heading" className="panel">
      <h2 id="two-step-heading">{translate(locale, "mfa.title")}</h2>
      <p>{translate(locale, "mfa.intro")}</p>
      {!mfa ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : mfa.totpEnabled ? (
        <>
          <p>{translate(locale, "mfa.on")}</p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void remove()}
            type="button"
          >
            {translate(locale, "mfa.remove")}
          </button>
        </>
      ) : enrollment ? (
        <form className="form-panel" onSubmit={confirm}>
          <p>{translate(locale, "mfa.scan")}</p>
          <img
            alt={translate(locale, "mfa.qrAlt")}
            height={180}
            src={enrollment.qrCode}
            width={180}
          />
          <p>
            {translate(locale, "mfa.secret")} <code>{enrollment.secret}</code>
          </p>
          <label htmlFor="totp-setup-code">{translate(locale, "mfa.code")}</label>
          <input
            autoComplete="one-time-code"
            id="totp-setup-code"
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            name="totpSetupCode"
            pattern="[0-9]{6}"
            required
          />
          <button className="primary-button" disabled={busy} type="submit">
            {translate(locale, "mfa.confirm")}
          </button>
        </form>
      ) : (
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void start()}
          type="button"
        >
          {translate(locale, "mfa.enable")}
        </button>
      )}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
