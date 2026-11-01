import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountDeletionStatus } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";

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
    <section aria-labelledby="deletion-heading" className="panel">
      <h2 id="deletion-heading">{translate(locale, "deletion.title")}</h2>
      {!deletion ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : deletion.pending ? (
        <>
          <p>
            {translate(locale, "deletion.pending")}{" "}
            {deletion.eraseAfter
              ? formatDateTime(locale, deletion.eraseAfter, "Europe/Stockholm")
              : null}
          </p>
          <p>{translate(locale, "deletion.pendingHelp")}</p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void cancel()}
            type="button"
          >
            {translate(locale, "deletion.cancel")}
          </button>
        </>
      ) : (
        <>
          <p>{translate(locale, "deletion.help")}</p>
          {deletion.blockers.length > 0 ? (
            <>
              <p>{translate(locale, "deletion.blockersIntro")}</p>
              <ul>
                {deletion.blockers.map((blocker) => (
                  <li key={`${blocker.kind}-${blocker.id}`}>
                    {blocker.kind === "owned_event" ? (
                      <Link to={`/events/${blocker.id}`}>{blocker.title}</Link>
                    ) : (
                      blocker.title
                    )}{" "}
                    — {translate(locale, `deletion.blocker.${blocker.kind}`)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <form className="form-panel" onSubmit={request}>
              <label htmlFor="deletion-confirmation">
                {translate(locale, "deletion.confirmLabel")}
              </label>
              <input
                autoComplete="off"
                id="deletion-confirmation"
                name="confirmationEmail"
                required
                type="email"
              />
              <button className="danger-button" disabled={busy} type="submit">
                {translate(locale, "deletion.request")}
              </button>
            </form>
          )}
        </>
      )}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
