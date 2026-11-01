import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountRecoveryStatus } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";

export function RecoveryCode({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const [busy, setBusy] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<AccountRecoveryStatus | null>(null);
  const [status, setStatus] = useState("");

  const loadRecovery = useCallback(async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    try {
      setRecovery(await api.getAccountRecoveryStatus(token));
    } catch {
      setStatus(translate(locale, "recovery.error"));
    }
  }, [accessToken, locale]);

  useEffect(() => {
    void loadRecovery();
  }, [loadRecovery]);

  const enroll = async () => {
    if (!recovery) return;
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setGeneratedCode(null);
    setStatus("");
    try {
      const result = await api.enrollRecoveryCode(token, {
        expectedVersion: recovery.version,
      });
      setRecovery(result);
      setGeneratedCode(result.code);
      setStatus(translate(locale, "recovery.created"));
    } catch (error) {
      if (error instanceof PromenadisApiError && error.code === "recent_auth_required") {
        setStatus(translate(locale, "recovery.recentAuth"));
      } else if (error instanceof PromenadisApiError && error.code === "version_conflict") {
        await loadRecovery();
        setStatus(translate(locale, "recovery.versionConflict"));
      } else {
        setStatus(translate(locale, "recovery.error"));
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelRecovery = async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token || !recovery?.pendingClaim) return;
    setBusy(true);
    setStatus("");
    try {
      setRecovery(await api.cancelAccountRecovery(token, recovery.pendingClaim.id));
      setStatus(translate(locale, "accountRecovery.cancelled"));
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "recent_auth_required"
            ? "recovery.recentAuth"
            : "recovery.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="recovery-heading" className="panel recovery-panel">
      <h2 id="recovery-heading">{translate(locale, "recovery.title")}</h2>
      <p>{translate(locale, "recovery.intro")}</p>
      {!recovery ? (
        <p aria-live="polite">{status || translate(locale, "common.loading")}</p>
      ) : (
        <>
          {recovery.pendingClaim ? (
            <div className="notice">
              <h3>{translate(locale, "accountRecovery.pendingTitle")}</h3>
              <p>{recovery.pendingClaim.newEmailMasked}</p>
              <p>
                {translate(
                  locale,
                  recovery.pendingClaim.emailVerified
                    ? "accountRecovery.verified"
                    : "accountRecovery.unverified",
                )}
              </p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void cancelRecovery()}
                type="button"
              >
                {translate(locale, "accountRecovery.cancel")}
              </button>
            </div>
          ) : null}
          <p className={recovery.active ? "notice notice-success" : "notice"}>
            {translate(locale, recovery.active ? "recovery.active" : "recovery.missing")}
          </p>
          {recovery.issuedAt ? (
            <p className="field-help">
              {translate(locale, "recovery.issued")}{" "}
              {formatDateTime(locale, recovery.issuedAt, "Europe/Stockholm")}
            </p>
          ) : null}
          {generatedCode ? (
            <div className="recovery-code-result" role="status">
              <strong>{translate(locale, "recovery.saveNow")}</strong>
              <code>{generatedCode}</code>
              <p>{translate(locale, "recovery.shownOnce")}</p>
            </div>
          ) : null}
          {recovery.active ? (
            <details className="settings-details">
              <summary>{translate(locale, "recovery.rotateTitle")}</summary>
              <p>{translate(locale, "recovery.rotateHelp")}</p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void enroll()}
                type="button"
              >
                {busy ? translate(locale, "common.saving") : translate(locale, "recovery.rotate")}
              </button>
            </details>
          ) : (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void enroll()}
              type="button"
            >
              {busy ? translate(locale, "common.saving") : translate(locale, "recovery.create")}
            </button>
          )}
        </>
      )}
      {recovery ? (
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
