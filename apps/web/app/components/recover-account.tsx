import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountRecoveryClaim } from "@promenadis/contracts";
import { formatDateTime, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { useStoredLocale } from "../lib/locale";
import { getPromenadisApiClient, hasLocalBackendConfiguration } from "../lib/supabase";
import { PageHeader } from "./page-header";

export function RecoverAccount() {
  const { locale, setLocale } = useStoredLocale();
  const [claim, setClaim] = useState<AccountRecoveryClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [link, setLink] = useState<{ claimId: string; verificationToken: string } | null>(null);
  const [completion, setCompletion] = useState<"completed" | "finishing" | null>(null);
  const [checking, setChecking] = useState(false);
  const [factor, setFactor] = useState<"recoveryCode" | "totp">("recoveryCode");

  useEffect(() => {
    // Fragments never reach the server. Keep the secret only in component memory.
    const readLink = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const claimId = fragment.get("claim");
      const verificationToken = fragment.get("token");
      if (claimId && verificationToken) {
        setLink({ claimId, verificationToken });
        setClaim(null);
        setCompletion(null);
        setStatus("");
        window.history.replaceState(window.history.state, "", window.location.pathname);
      }
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);

  useEffect(() => {
    // A reopened link for an already verified request goes straight to the
    // wait or finish step. Reading never verifies or consumes the code.
    const api = getPromenadisApiClient();
    if (!api || !link) return;
    let current = true;
    setChecking(true);
    api
      .readAccountRecoveryClaim(link.claimId, { verificationToken: link.verificationToken })
      .then((summary) => {
        if (current && summary.emailVerified) setClaim(summary);
      })
      .catch(() => {
        if (current) setStatus(translate(locale, "accountRecovery.unavailable"));
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [link, locale]);

  const confirm = async () => {
    const api = getPromenadisApiClient();
    if (!api || !link) return;
    setBusy(true);
    setStatus("");
    try {
      setClaim(
        await api.confirmAccountRecoveryEmail(link.claimId, {
          verificationToken: link.verificationToken,
        }),
      );
      setStatus(translate(locale, "accountRecovery.verified"));
    } catch {
      setStatus(translate(locale, "accountRecovery.unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    const api = getPromenadisApiClient();
    if (!api || !link) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await api.completeAccountRecovery(link.claimId, {
        verificationToken: link.verificationToken,
      });
      setCompletion(result.state);
      if (result.state === "completed") setLink(null);
      setStatus(
        translate(
          locale,
          result.state === "completed" ? "accountRecovery.completed" : "accountRecovery.finishing",
        ),
      );
    } catch {
      setStatus(translate(locale, "accountRecovery.completeUnavailable"));
    } finally {
      setBusy(false);
    }
  };

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const api = getPromenadisApiClient();
    if (!api) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setStatus("");
    try {
      const emails = {
        currentEmail: String(data.get("currentEmail") ?? "").trim(),
        newEmail: String(data.get("newEmail") ?? "").trim(),
      };
      await api.initiateAccountRecovery(
        factor === "totp"
          ? { ...emails, totpCode: String(data.get("totpCode") ?? "").trim() }
          : {
              ...emails,
              recoveryCode: String(data.get("recoveryCode") ?? "")
                .trim()
                .toUpperCase(),
            },
      );
      form.reset();
      setStatus(translate(locale, "accountRecovery.sentLocal"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "delivery_unavailable"
            ? "accountRecovery.deliveryFailed"
            : code === "rate_limited"
              ? "accountRecovery.rateLimited"
              : code === "claim_pending"
                ? "accountRecovery.pending"
                : "accountRecovery.invalid",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {translate(locale, "home.skip")}
      </a>
      <PageHeader locale={locale} onLocaleChange={setLocale} />
      <main className="account-page" id="main" tabIndex={-1}>
        <a className="back-link" href="/sign-in">
          ← {translate(locale, "accountRecovery.back")}
        </a>
        <div className="account-heading">
          <p className="eyebrow">Promenadis</p>
          <h1>{translate(locale, "accountRecovery.title")}</h1>
          <p className="lede">{translate(locale, "accountRecovery.intro")}</p>
        </div>
        <p className="notice">{translate(locale, "accountRecovery.preview")}</p>
        {!hasLocalBackendConfiguration() ? (
          <p className="notice notice-error" role="alert">
            {translate(locale, "auth.configMissing")}
          </p>
        ) : checking ? (
          <p className="form-status">{translate(locale, "accountRecovery.checking")}</p>
        ) : completion === "completed" ? (
          <section className="panel form-panel">
            <a className="primary-button" href="/sign-in">
              {translate(locale, "accountRecovery.signIn")}
            </a>
          </section>
        ) : claim && link && Date.parse(claim.readyAt) <= Date.now() ? (
          <section className="panel form-panel">
            <h2>{translate(locale, "accountRecovery.readyTitle")}</h2>
            <p>{translate(locale, "accountRecovery.completeHelp")}</p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void complete()}
              type="button"
            >
              {translate(locale, "accountRecovery.complete")}
            </button>
          </section>
        ) : claim ? (
          <section className="panel form-panel">
            <h2>{translate(locale, "accountRecovery.waitTitle")}</h2>
            <p>{translate(locale, "accountRecovery.waitHelp")}</p>
            <p>
              {translate(locale, "accountRecovery.readyAt")}{" "}
              {formatDateTime(locale, claim.readyAt, "Europe/Stockholm")}
            </p>
            <p>
              {translate(locale, "accountRecovery.expiresAt")}{" "}
              {formatDateTime(locale, claim.expiresAt, "Europe/Stockholm")}
            </p>
          </section>
        ) : link ? (
          <section className="panel form-panel">
            <p>{translate(locale, "accountRecovery.confirmHelp")}</p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void confirm()}
              type="button"
            >
              {translate(locale, "accountRecovery.confirm")}
            </button>
          </section>
        ) : (
          <form className="panel form-panel" onSubmit={start}>
            <label htmlFor="currentEmail">
              {translate(locale, "accountRecovery.currentEmail")}
            </label>
            <input
              autoComplete="email"
              id="currentEmail"
              name="currentEmail"
              required
              type="email"
            />
            <fieldset className="choice-group">
              <legend>{translate(locale, "accountRecovery.factor")}</legend>
              <label className="checkbox-field">
                <input
                  checked={factor === "recoveryCode"}
                  name="factor"
                  onChange={() => setFactor("recoveryCode")}
                  type="radio"
                />
                <span>{translate(locale, "accountRecovery.factorCode")}</span>
              </label>
              <label className="checkbox-field">
                <input
                  checked={factor === "totp"}
                  name="factor"
                  onChange={() => setFactor("totp")}
                  type="radio"
                />
                <span>{translate(locale, "accountRecovery.factorTotp")}</span>
              </label>
            </fieldset>
            {factor === "totp" ? (
              <>
                <label htmlFor="totpCode">{translate(locale, "mfa.code")}</label>
                <input
                  autoComplete="one-time-code"
                  id="totpCode"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="totpCode"
                  pattern="[0-9]{6}"
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="recoveryCode">{translate(locale, "accountRecovery.code")}</label>
                <input
                  autoComplete="off"
                  id="recoveryCode"
                  name="recoveryCode"
                  maxLength={24}
                  pattern="[A-HJ-NP-Za-hj-np-z2-9]{4}(-[A-HJ-NP-Za-hj-np-z2-9]{4}){4}"
                  required
                />
              </>
            )}
            <label htmlFor="newEmail">{translate(locale, "accountRecovery.newEmail")}</label>
            <input autoComplete="email" id="newEmail" name="newEmail" required type="email" />
            <button className="primary-button" disabled={busy} type="submit">
              {busy
                ? translate(locale, "common.saving")
                : translate(locale, "accountRecovery.start")}
            </button>
            <a href="http://127.0.0.1:54324" rel="noreferrer">
              {translate(locale, "auth.mailpit")}
            </a>
          </form>
        )}
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      </main>
    </div>
  );
}
